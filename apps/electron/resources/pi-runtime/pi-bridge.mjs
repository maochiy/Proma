import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function piWorkerStartupError(message, code = 'PI_WORKER_STARTUP_FAILED') {
  return Object.assign(new Error(message), { code });
}

export function createPiBridge({ workerPath = path.join(__dirname, 'workers', 'pi-worker.mjs'), env = {}, runtimeBinding = null, toolHandler, credentialHandler }) {
  const emitter = new EventEmitter();
  const pending = new Map();
  let child = null;
  let sequence = 0;
  let readyPromise = null;
  let readyInfo = null;

  function failPending(error) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }

  function handleMessage(message) {
    if (message?.type === 'ready') {
      readyInfo = message;
      emitter.emit('ready', message);
      return;
    }
    if (message?.type === 'event') {
      emitter.emit('event', message);
      return;
    }
    if (message?.type === 'tool.request') {
      Promise.resolve(toolHandler?.(message.name, message.params || {}, message.context || {}))
        .then((result) => child?.send({ type: 'tool.response', requestId: message.requestId, result }))
        .catch((error) => child?.send({ type: 'tool.response', requestId: message.requestId, error: error.message || String(error) }));
      return;
    }
    if (message?.type === 'credential.request') {
      Promise.resolve(credentialHandler?.(message.operation, message.providerId, message.credential, message.accountId || ''))
        .then((credential) => child?.send({ type: 'credential.response', requestId: message.requestId, credential }))
        .catch((error) => child?.send({ type: 'credential.response', requestId: message.requestId, error: error.message || String(error) }));
      return;
    }
    const item = pending.get(message?.requestId);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.requestId);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message);
  }

  async function ensureStarted() {
    if (child?.connected) return child;
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve, reject) => {
      const next = fork(workerPath, [], {
        env: {
          ...process.env,
          ...env,
          ...(runtimeBinding ? {
            FRAKIO_PI_RUNTIME_ROOT: runtimeBinding.runtimeDir || '',
            FRAKIO_PI_RUNTIME_VERSION: runtimeBinding.runtimeVersion || '',
            FRAKIO_PI_RUNTIME_BUILD_ID: runtimeBinding.runtimeBuildId || '',
            FRAKIO_PI_HOST_PROTOCOL_VERSION: String(runtimeBinding.adapterProtocolVersion || 1),
          } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'advanced',
      });
      child = next;
      const stderr = [];
      next.stderr?.on('data', (chunk) => {
        stderr.push(String(chunk));
        if (stderr.length > 20) stderr.shift();
      });
      const timer = setTimeout(() => {
        reject(piWorkerStartupError(`Pi Worker startup timed out.${stderr.length ? ` ${stderr.join('').slice(-1000)}` : ''}`, 'PI_WORKER_STARTUP_TIMEOUT'));
        next.kill('SIGTERM');
      }, 20000);
      const onReady = () => {
        clearTimeout(timer);
        emitter.off('ready', onReady);
        resolve(next);
      };
      emitter.on('ready', onReady);
      next.on('message', handleMessage);
      next.once('error', (error) => {
        clearTimeout(timer);
        reject(piWorkerStartupError(error.message || String(error)));
      });
      next.once('exit', (code, signal) => {
        clearTimeout(timer);
        const error = piWorkerStartupError(`Pi Worker exited code=${code ?? ''} signal=${signal ?? ''}.${stderr.length ? ` ${stderr.join('').slice(-1000)}` : ''}`);
        if (!readyInfo) reject(error);
        failPending(error);
        child = null;
        readyPromise = null;
        emitter.emit('exit', error);
      });
    }).finally(() => {
      if (!child?.connected) readyPromise = null;
    });
    return readyPromise;
  }

  async function request(type, payload = {}, timeoutMs = 30000) {
    const processHandle = await ensureStarted();
    const requestId = `pi_bridge_${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Pi Worker request timed out: ${type}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      processHandle.send({ type, requestId, ...payload });
    });
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    ensureStarted,
    async inspect() {
      await ensureStarted();
      return readyInfo;
    },
    async startRun(payload) {
      return request('run.start', payload, 120000);
    },
    async steer(sessionId, message) {
      return request('run.steer', { sessionId, message });
    },
    async cancel(sessionId) {
      return request('run.cancel', { sessionId });
    },
    async compact(sessionId, input = {}) {
      return request('session.compact', { sessionId, instructions: input.instructions || '' }, 120000);
    },
    async disposeSession(sessionId) {
      return request('session.dispose', { sessionId });
    },
    async close() {
      if (!child) return;
      const current = child;
      child = null;
      readyPromise = null;
      readyInfo = null;
      current.disconnect();
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          current.kill('SIGTERM');
          resolve();
        }, 1500);
        current.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

export function createPiBridgePool({ bindingResolver, bridgeFactory = createPiBridge, env = {}, toolHandler, credentialHandler } = {}) {
  const emitter = new EventEmitter();
  const bridges = new Map();
  const sessionBuilds = new Map();
  const runBuilds = new Map();
  const runEventSequences = new Map();

  async function resolveBinding(input = {}) {
    return input.runtimeBinding || bindingResolver?.(input) || null;
  }

  function bridgeFor(binding) {
    const buildId = String(binding?.runtimeBuildId || 'bundled');
    let bridge = bridges.get(buildId);
    if (bridge) return bridge;
    bridge = bridgeFactory({ runtimeBinding: binding, env, toolHandler, credentialHandler });
    bridge.on('event', (message) => {
      const runId = String(message?.runId || '');
      const nativeSequence = Number(runEventSequences.get(runId) || 0) + 1;
      runEventSequences.set(runId, nativeSequence);
      emitter.emit('event', {
        ...message,
        event: { ...(message.event || {}), nativeSequence, nativeEventKey: `pi:${binding.runtimeBuildId}:${runId}:${nativeSequence}` },
        runtimeBinding: binding,
      });
      if (['run.completed', 'run.failed', 'run.cancelled'].includes(message?.event?.type)) runEventSequences.delete(runId);
    });
    bridge.on('exit', (error) => emitter.emit('exit', { error, runtimeBinding: binding }));
    bridges.set(buildId, bridge);
    return bridge;
  }

  async function bridgeForSession(sessionId) {
    const buildId = sessionBuilds.get(String(sessionId || ''));
    if (!buildId) return null;
    return bridges.get(buildId) || null;
  }

  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    async probe(input = {}) {
      const binding = await resolveBinding(input);
      if (!binding) return { status: 'unsupported', capability: 'probe' };
      const ready = await bridgeFor(binding).inspect();
      return { status: 'ready', ...ready, runtimeBinding: binding };
    },
    async startRun(payload) {
      const binding = await resolveBinding(payload);
      if (!binding) throw new Error('Pi Runtime binding is unavailable.');
      const bridge = bridgeFor(binding);
      const accepted = await bridge.startRun({ ...payload, runtimeBinding: binding });
      sessionBuilds.set(String(payload.sessionId || ''), binding.runtimeBuildId);
      runBuilds.set(String(payload.runId || ''), binding.runtimeBuildId);
      return { ...accepted, runtimeVersion: binding.runtimeVersion, runtimeBuildId: binding.runtimeBuildId };
    },
    async steer(sessionId, message) {
      const bridge = await bridgeForSession(sessionId);
      if (!bridge) throw new Error('Pi session binding is unavailable.');
      return bridge.steer(sessionId, message);
    },
    async cancel(sessionId) {
      const bridge = await bridgeForSession(sessionId);
      if (!bridge) return { ok: false };
      return bridge.cancel(sessionId);
    },
    async compact(sessionId, input = {}) {
      const bridge = await bridgeForSession(sessionId);
      if (!bridge) return { status: 'unsupported', capability: 'compact' };
      return bridge.compact(sessionId, input);
    },
    async resolveApproval() {
      return { status: 'unsupported', capability: 'resolveApproval' };
    },
    async disposeSession(sessionId) {
      const key = String(sessionId || '');
      const bridge = await bridgeForSession(key);
      if (bridge) await bridge.disposeSession(key);
      sessionBuilds.delete(key);
      return { ok: true };
    },
    async inspect(input = {}) {
      return this.probe(input);
    },
    async close() {
      await Promise.all(Array.from(bridges.values(), (bridge) => bridge.close().catch(() => {})));
      bridges.clear();
      sessionBuilds.clear();
      runBuilds.clear();
      runEventSequences.clear();
    },
    bridgeCount() { return bridges.size; },
  };
}

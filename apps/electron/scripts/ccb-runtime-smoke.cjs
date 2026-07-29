const { app, MessageChannelMain, utilityProcess } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const smokeConfigDir = join(tmpdir(), 'proma-ccb-runtime-smoke')
const runtimeRoot = process.env.PROMA_CCB_RUNTIME_PATH
if (!runtimeRoot) {
  throw new Error('请设置 PROMA_CCB_RUNTIME_PATH')
}
const runtimeManifest = JSON.parse(
  readFileSync(join(runtimeRoot, 'runtime-manifest.json'), 'utf8'),
)
const PROTOCOL_VERSION = runtimeManifest.protocolVersion

app.whenReady().then(async () => {
  let expectedExit = false
  let resultMessageCount = 0
  let turnCompleted = false
  let stateRequested = false
  let modelCatalogValidated = false

  const child = utilityProcess.fork(join(runtimeRoot, 'entry.js'), [], {
    serviceName: 'Proma CCB Runtime Smoke Test',
    stdio: 'pipe',
  })
  child.stdout?.on('data', data => process.stdout.write(`[host stdout] ${data}`))
  child.stderr?.on('data', data => process.stderr.write(`[host stderr] ${data}`))
  child.on('exit', code => {
    if (!expectedExit) {
      console.error(`CCB Runtime Host 提前退出: ${code}`)
      app.exit(1)
    }
  })
  const control = new MessageChannelMain()
  const stream = new MessageChannelMain()
  const timeout = setTimeout(() => {
    console.error('CCB Runtime Host 初始化超时')
    child.kill()
    app.exit(1)
  }, 60_000)

  const fail = message => {
    clearTimeout(timeout)
    console.error(message)
    child.kill()
    app.exit(1)
  }

  const requestStateWhenReady = () => {
    if (!turnCompleted || resultMessageCount < 2 || stateRequested) return
    stateRequested = true
    control.port1.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'smoke-session-state',
      sessionId: 'smoke-session',
      timestamp: Date.now(),
      payload: { type: 'session.getState' },
    })
  }

  control.port1.on('message', event => {
    console.log('[smoke control]', event.data)
    const payload = event.data?.payload
    if (payload?.type === 'host.ready') {
      control.port1.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'smoke-capabilities',
        timestamp: Date.now(),
        payload: { type: 'host.getCapabilities' },
      })
      return
    }
    if (
      payload?.type === 'response.success' &&
      payload.responseTo === 'smoke-capabilities'
    ) {
      control.port1.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'smoke-model-catalog',
        sessionId: '__model-catalog__:smoke',
        timestamp: Date.now(),
        payload: {
          type: 'session.resolveModelCatalog',
          cwd: process.cwd(),
          environment: {
            variables: {
              ANTHROPIC_API_KEY: 'smoke-local-key',
              ANTHROPIC_MODEL: 'claude-sonnet-4-6[1m]',
            },
            configDir: smokeConfigDir,
          },
          providerConfiguration: {
            modelType: 'anthropic',
            defaultModel: 'claude-sonnet-4-6[1m]',
            models: [
              {
                id: 'claude-sonnet-4-6[1m]',
                name: 'Claude Sonnet 4.6 1M',
              },
            ],
          },
        },
      })
      return
    }
    if (
      payload?.type === 'response.success' &&
      payload.responseTo === 'smoke-model-catalog'
    ) {
      const model = payload.result?.models?.[0]
      const contextPolicy = payload.result?.contextPolicy
      const modelContextPolicy = contextPolicy?.models?.[0]
      if (
        payload.result?.defaultModel !== 'claude-sonnet-4-6'
        || model?.value !== 'claude-sonnet-4-6'
        || model?.contextWindow !== 1_000_000
        || typeof contextPolicy?.autoCompactEnabled !== 'boolean'
        || modelContextPolicy?.model !== 'claude-sonnet-4-6'
        || modelContextPolicy?.contextWindow !== 1_000_000
        || !(modelContextPolicy?.effectiveContextWindow > 0)
        || !(
          modelContextPolicy?.autoCompactThreshold
          <= modelContextPolicy?.effectiveContextWindow
        )
      ) {
        fail(`模型目录解析异常: ${JSON.stringify(payload.result)}`)
        return
      }
      modelCatalogValidated = true
      control.port1.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'smoke-session-open',
        sessionId: 'smoke-session',
        timestamp: Date.now(),
        payload: {
          type: 'session.open',
          options: {
            cwd: process.cwd(),
            permissionMode: 'default',
            environment: {
              variables: {
                PATH: process.env.PATH || '',
                HOME: process.env.HOME || '',
                SHELL: process.env.SHELL || '',
              },
              configDir: smokeConfigDir,
            },
            includePartialMessages: true,
          },
        },
      })
      return
    }
    if (
      payload?.type === 'response.success' &&
      payload.responseTo === 'smoke-session-open'
    ) {
      control.port1.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'smoke-turn-start',
        sessionId: 'smoke-session',
        timestamp: Date.now(),
        payload: {
          type: 'turn.start',
          prompt: '/version',
          uuid: '00000000-0000-4000-8000-000000000001',
        },
      })
      return
    }
    if (
      payload?.type === 'response.success' &&
      payload.responseTo === 'smoke-turn-start'
    ) {
      control.port1.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'smoke-turn-enqueue',
        sessionId: 'smoke-session',
        timestamp: Date.now(),
        payload: {
          type: 'turn.enqueue',
          prompt: '/version',
          uuid: '00000000-0000-4000-8000-000000000002',
          priority: 'next',
        },
      })
      return
    }
    if (payload?.type === 'turn.completed') {
      turnCompleted = true
      requestStateWhenReady()
      return
    }
    if (
      payload?.type === 'response.success' &&
      payload.responseTo === 'smoke-session-state'
    ) {
      if (payload.result?.running || payload.result?.queuedTurns !== 0) {
        fail(`Turn 状态异常: ${JSON.stringify(payload.result)}`)
        return
      }
      control.port1.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'smoke-host-shutdown',
        timestamp: Date.now(),
        payload: { type: 'host.shutdown' },
      })
      return
    }
    if (
      payload?.type === 'response.success' &&
      payload.responseTo === 'smoke-host-shutdown'
    ) {
      clearTimeout(timeout)
      expectedExit = true
      console.log(
        `CCB Runtime 完整 smoke test passed: 模型目录=${modelCatalogValidated ? '已校验' : '未校验'}，${resultMessageCount} 个本地命令结果，队列已清空`,
      )
      app.exit(0)
      return
    }
    if (payload?.type === 'response.failure') {
      fail(payload.error)
    }
  })
  stream.port1.on('message', event => {
    console.log('[smoke stream]', event.data)
    const payload = event.data?.payload
    if (payload?.type !== 'runtime.message') return
    if (payload.message?.type === 'result') {
      resultMessageCount += 1
      requestStateWhenReady()
    }
  })
  control.port1.start()
  stream.port1.start()
  child.once('spawn', () => {
    child.postMessage({ type: 'desktop.attachPorts' }, [control.port2, stream.port2])
  })
})

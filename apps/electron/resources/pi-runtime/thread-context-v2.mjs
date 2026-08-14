import { createHash, randomUUID } from 'node:crypto';

const STATE_TYPES = ['goal', 'decision', 'requirement', 'constraint', 'task', 'artifact', 'finding', 'risk', 'open_question'];
const RELAY_PREFIX = /^群聊系统：(.+?)(?:在对话中提及了你|将任务转交给你)（(.+?)）/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function contextDigest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function normalizeStatement(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
}

function stateTypeForMessage(message) {
  const text = String(message?.content || '');
  if (/决定|确认采用|最终方案|approved|decision/i.test(text)) return 'decision';
  if (/目标|目的是|需要实现|goal/i.test(text)) return 'goal';
  if (/必须|不得|不能|约束|constraint/i.test(text)) return 'constraint';
  if (/需求|验收|requirement/i.test(text)) return 'requirement';
  if (/风险|隐患|risk/i.test(text)) return 'risk';
  if (/待确认|未知|问题是|open question/i.test(text)) return 'open_question';
  return '';
}

function stateItemFromMessage(message, eventId) {
  const type = stateTypeForMessage(message);
  if (!type) return null;
  const statement = normalizeStatement(message.content);
  const authority = message.agentId === 'user'
    ? (type === 'decision' && /确认|决定|采用|就按|approved/i.test(statement) ? 'user_confirmed' : 'inferred')
    : 'agent_proposed';
  return {
    id: `state_${contextDigest([message.id, type]).slice(0, 24)}`,
    type,
    status: 'active',
    statement,
    authority,
    scope: 'thread',
    sourceEventIds: [eventId],
    sourceMessageIds: [message.id],
    relatedTaskIds: [],
    relatedArtifactIds: [],
    supersedes: [],
    ownerAgentId: message.agentId === 'user' ? '' : message.agentId,
    conflictKey: String(message.contextStateKey || '').trim(),
    revision: 1,
    updatedAt: message.createdAt || new Date().toISOString(),
  };
}

export function isLegacyInternalRelay(thread, index) {
  const messages = thread?.messages || [];
  const message = messages[index];
  if (!message || message.agentId !== 'user' || !RELAY_PREFIX.test(String(message.content || ''))) return false;
  const next = messages[index + 1];
  if (!next || next.agentId === 'user' || next.routeReason !== 'agent_mention') return false;
  const match = String(message.content || '').match(RELAY_PREFIX);
  return Boolean(match && String(next.agentName || '').trim() === String(match[2] || '').trim());
}

export function publicThreadView(thread, { hideLegacyRelayMessages = true } = {}) {
  if (!thread || !hideLegacyRelayMessages) return thread;
  const hiddenIds = new Set((thread.messages || []).flatMap((message, index) => isLegacyInternalRelay(thread, index) ? [message.id] : []));
  if (!hiddenIds.size) return thread;
  return {
    ...thread,
    messages: (thread.messages || []).filter((message) => !hiddenIds.has(message.id)),
  };
}

function eventAuthority(message) {
  if (message.agentId === 'user') return /确认|决定|采用|就按|approved/i.test(String(message.content || '')) ? 'user_confirmed' : 'inferred';
  if (message.agentId === 'system') return 'system_recorded';
  return 'agent_proposed';
}

export function syncThreadContextEvents(store, thread) {
  const pending = [];
  const append = (event) => pending.push(event);
  for (const [index, message] of (thread.messages || []).entries()) {
    const eventId = `thread_event_${contextDigest([thread.id, 'message.created', message.id]).slice(0, 24)}`;
    const visibility = isLegacyInternalRelay(thread, index) ? 'internal' : 'public';
    const stateItem = visibility === 'public' ? stateItemFromMessage(message, eventId) : null;
    append({
      id: eventId,
      threadId: thread.id,
      eventType: 'message.created',
      actorType: message.agentId === 'user' ? 'user' : message.agentId === 'system' ? 'system' : 'agent',
      actorId: message.agentId || '',
      sourceId: message.id,
      parentEventId: message.parentMessageId || '',
      visibility,
      authority: eventAuthority(message),
      payload: { message: { ...message, handoffs: undefined }, stateItem },
      createdAt: message.createdAt,
    });
    for (const handoff of message.handoffs || []) {
      append({
        threadId: thread.id,
        eventType: handoff.status === 'failed' ? 'handoff.failed' : handoff.status === 'completed' ? 'handoff.completed' : 'handoff.created',
        actorType: 'system',
        actorId: message.agentId || '',
        sourceId: `${message.id}:${handoff.routeId}`,
        sourceRevision: handoff.status === 'failed' ? 3 : handoff.status === 'completed' ? 2 : 1,
        visibility: 'internal',
        authority: 'system_recorded',
        payload: { handoff },
        createdAt: handoff.updatedAt || handoff.createdAt,
      });
    }
  }
  for (const task of thread.workflowState || []) {
    const sourceId = String(task.id || contextDigest(task).slice(0, 24));
    append({
      threadId: thread.id,
      eventType: 'task.changed',
      actorType: 'system',
      sourceId,
      sourceRevision: Number(task.revision || 1),
      visibility: 'internal',
      authority: 'system_recorded',
      payload: { stateItem: {
        id: `state_task_${sourceId}`,
        type: 'task', status: ['completed', 'failed'].includes(task.status) ? 'resolved' : 'active',
        statement: normalizeStatement(task.title || task.detail), authority: 'system_recorded', scope: 'thread',
        sourceEventIds: [], sourceMessageIds: [], relatedTaskIds: [sourceId], relatedArtifactIds: [], supersedes: [], ownerAgentId: task.agentId || '', revision: Number(task.revision || 1), updatedAt: task.updatedAt || thread.updatedAt,
      } },
      createdAt: task.updatedAt || thread.updatedAt,
    });
  }
  for (const artifact of thread.artifacts || []) {
    const sourceId = String(artifact.id || artifact.path || contextDigest(artifact).slice(0, 24));
    append({
      threadId: thread.id,
      eventType: 'artifact.changed', actorType: 'system', sourceId, sourceRevision: Number(artifact.revision || 1),
      visibility: 'internal', authority: 'tool_verified',
      payload: { artifact, stateItem: {
        id: `state_artifact_${contextDigest(sourceId).slice(0, 20)}`, type: 'artifact', status: 'active', statement: normalizeStatement(artifact.name || artifact.path), authority: 'tool_verified', scope: 'thread',
        sourceEventIds: [], sourceMessageIds: [], relatedTaskIds: [], relatedArtifactIds: [sourceId], supersedes: [], ownerAgentId: '', revision: Number(artifact.revision || 1), updatedAt: artifact.updatedAt || thread.updatedAt,
      } }, createdAt: artifact.updatedAt || thread.updatedAt,
    });
  }
  return store.putThreadContextEvents(pending);
}

function emptyState() {
  return Object.fromEntries(STATE_TYPES.map((type) => [type, []]));
}

function applyStateEvent(state, event) {
  const item = event.payload?.stateItem;
  if (!item || !STATE_TYPES.includes(item.type)) return;
  const next = { ...item, sourceEventIds: [...new Set([...(item.sourceEventIds || []), event.id])], updatedAt: item.updatedAt || event.createdAt };
  const list = state[item.type] || [];
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = next;
  else list.push(next);
  for (const supersededId of next.supersedes || []) {
    for (const type of STATE_TYPES) {
      const target = (state[type] || []).find((entry) => entry.id === supersededId);
      if (target) target.status = 'superseded';
    }
  }
}

function stateConflicts(state) {
  const groups = new Map();
  for (const item of state.decision || []) {
    if (item.status !== 'active' || !item.conflictKey) continue;
    const rows = groups.get(item.conflictKey) || [];
    rows.push(item);
    groups.set(item.conflictKey, rows);
  }
  return [...groups.entries()].filter(([, rows]) => new Set(rows.map((row) => row.statement)).size > 1).map(([key, rows]) => ({
    id: `conflict_${contextDigest([key, rows.map((row) => row.id)]).slice(0, 20)}`,
    key,
    stateItemIds: rows.map((row) => row.id),
    reason: '存在未解决的相互矛盾决策。',
  }));
}

export function projectThreadState(store, threadId, { force = false } = {}) {
  let snapshot = force ? null : store.getThreadStateSnapshot(threadId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const expectedRevision = Number(snapshot?.revision || 0);
    const state = structuredClone(snapshot?.state?.items || emptyState());
    const events = store.listThreadContextEvents(threadId, { afterCursor: snapshot?.throughCursor || 0, limit: 50000 });
    for (const event of events) applyStateEvent(state, event);
    const throughCursor = events.at(-1)?.cursor || snapshot?.throughCursor || 0;
    const projected = { items: state, conflicts: stateConflicts(state) };
    const contentHash = contextDigest(projected);
    if (snapshot && !events.length && snapshot.contentHash === contentHash) return snapshot;
    const saved = store.putThreadStateSnapshot({ threadId, revision: expectedRevision + 1, throughCursor, state: projected, contentHash }, expectedRevision);
    if (saved) return saved;
    snapshot = store.getThreadStateSnapshot(threadId);
  }
  return { ...(snapshot || { threadId, revision: 0, throughCursor: 0, state: { items: emptyState(), conflicts: [] }, contentHash: '' }), status: 'stale', error: 'state_cas_conflict' };
}

function publicMessageRecord(event) {
  const message = event.payload?.message || {};
  return {
    cursor: event.cursor,
    messageId: message.id || event.sourceId,
    agentId: message.agentId || event.actorId,
    agentName: message.agentName || '',
    role: message.role || '',
    content: String(message.content || '').slice(0, 20000),
    turnId: message.turnId || '',
    createdAt: message.createdAt || event.createdAt,
  };
}

function queryTerms(query) {
  return [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [])].slice(0, 24);
}

function relevantRecords(records, query, excludedIds, mandatoryIds) {
  const terms = queryTerms(query);
  return records
    .filter((row) => !excludedIds.has(row.messageId))
    .map((row) => ({ row, score: mandatoryIds.has(row.messageId) ? 1000 : terms.reduce((score, term) => score + (row.content.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.row.cursor - a.row.cursor)
    .slice(0, 40)
    .map(({ row }) => row);
}

function trimRecords(records, tokenLimit) {
  const kept = [];
  let used = 0;
  for (const record of records) {
    const tokens = estimateTokens(record);
    if (used + tokens > tokenLimit) continue;
    kept.push(record);
    used += tokens;
  }
  return { records: kept, tokens: used };
}

export function compileThreadContextV2({ store, thread, agent, runtimeId, query = '', basePacket = {}, handoff = null, contextWindow = 128000, maxOutputTokens = 16384, runId = '', writeReceipt = true, cursorFrom = 0 } = {}) {
  syncThreadContextEvents(store, thread);
  const snapshot = projectThreadState(store, thread.id);
  const events = store.listThreadContextEvents(thread.id, { limit: 50000, visibility: 'public' });
  const allRecords = events.filter((event) => event.eventType === 'message.created').map(publicMessageRecord);
  const normalizedCursorFrom = Math.max(0, Number(cursorFrom || 0));
  const incrementalRecords = normalizedCursorFrom
    ? events.filter((event) => event.cursor > normalizedCursorFrom && event.eventType === 'message.created').map(publicMessageRecord)
    : allRecords;
  const recentConversation = (normalizedCursorFrom ? incrementalRecords : allRecords).slice(-12);
  const recentIds = new Set(recentConversation.map((row) => row.messageId));
  const activeItems = Object.values(snapshot.state?.items || {}).flat().filter((item) => item.status === 'active');
  const mandatoryIds = new Set(activeItems.flatMap((item) => item.sourceMessageIds || []));
  const candidates = relevantRecords(normalizedCursorFrom ? incrementalRecords : allRecords, query, recentIds, mandatoryIds);
  const outputReserve = Math.max(16384, Number(maxOutputTokens || 0));
  const effectiveLimit = Math.max(1024, Number(contextWindow || 128000) - outputReserve);
  const softLimit = Math.floor(effectiveLimit * 0.7);
  const hardLimit = Math.floor(effectiveLimit * 0.9);
  const fixedTokens = estimateTokens({ identity: agent, sharedState: snapshot.state, handoff, policy: basePacket.contextPolicy });
  const remaining = Math.max(0, softLimit - fixedTokens);
  const recent = trimRecords(recentConversation, Math.floor(remaining * 0.35));
  const relevant = trimRecords(candidates, Math.floor(remaining * 0.25));
  const memoryAndKnowledge = [...(basePacket.memory || []), ...(basePacket.personalKnowledge || []), ...(basePacket.projectKnowledge || []), ...(basePacket.projectRules || [])];
  const knowledge = trimRecords(memoryAndKnowledge, Math.floor(remaining * 0.25));
  const artifactReferences = activeItems.filter((item) => item.type === 'artifact').map((item) => ({ id: item.id, statement: item.statement, relatedArtifactIds: item.relatedArtifactIds }));
  const artifacts = trimRecords(artifactReferences, Math.min(Math.floor(remaining * 0.15), Math.floor(effectiveLimit * 0.2)));
  const warnings = [];
  if (snapshot.status === 'stale') warnings.push({ code: 'state_stale', message: snapshot.error || 'Thread state is stale.' });
  const compiledAt = new Date().toISOString();
  const packet = {
    ...basePacket,
    schemaVersion: 2,
    packetId: `context_packet_${randomUUID()}`,
    threadId: thread.id,
    runId,
    targetAgentId: agent.id,
    runtimeId,
    compiledAt,
    cursor: { from: Math.max(0, Math.min(normalizedCursorFrom, snapshot.throughCursor)), to: snapshot.throughCursor, stateRevision: snapshot.revision },
    identity: { agentId: agent.id, profileRevision: agent.profileRevision || '', role: agent.role || '' },
    permissions: { policyRevision: agent.runtimePolicy?.permissionProfileId || 'default', coverage: '' },
    sharedState: {
      goal: snapshot.state?.items?.goal || [], decisions: snapshot.state?.items?.decision || [], requirements: snapshot.state?.items?.requirement || [], constraints: snapshot.state?.items?.constraint || [],
      tasks: snapshot.state?.items?.task || [], artifacts: snapshot.state?.items?.artifact || [], findings: snapshot.state?.items?.finding || [], risks: snapshot.state?.items?.risk || [], openQuestions: snapshot.state?.items?.open_question || [],
    },
    handoff,
    recentConversation: recent.records,
    relevantHistory: relevant.records,
    memory: basePacket.memory || [],
    knowledge: [...(basePacket.personalKnowledge || []), ...(basePacket.projectKnowledge || []), ...(basePacket.projectRules || [])],
    artifactReferences: artifacts.records,
    conflicts: snapshot.state?.conflicts || [],
    missingContext: [],
    warnings,
    sourceReceiptIds: [basePacket.memorySelection?.receiptId].filter(Boolean),
    budget: { contextWindow, outputReserve, effectiveLimit, softLimit, hardLimit, estimatedTokens: fixedTokens + recent.tokens + relevant.tokens + knowledge.tokens + artifacts.tokens, sections: { fixed: fixedTokens, recentConversation: recent.tokens, relevantHistory: relevant.tokens, memoryAndKnowledge: knowledge.tokens, artifacts: artifacts.tokens } },
  };
  packet.packetHash = contextDigest({ ...packet, packetId: '', compiledAt: '', warnings: packet.warnings });
  if (packet.budget.estimatedTokens > hardLimit) throw Object.assign(new Error('ContextPacket V2 exceeds the hard context budget.'), { code: 'CONTEXT_BUDGET_EXCEEDED', status: 409 });
  const included = [
    { kind: 'thread_state', count: activeItems.length },
    { kind: 'recent_conversation', count: packet.recentConversation.length },
    { kind: 'relevant_history', count: packet.relevantHistory.length },
    { kind: 'memory', count: packet.memory.length },
    { kind: 'knowledge', count: packet.knowledge.length },
    { kind: 'artifacts', count: packet.artifactReferences.length },
  ];
  const receipt = writeReceipt ? store.putContextReceipt({ packetId: packet.packetId, packetHash: packet.packetHash, threadId: thread.id, runId, runtimeId, agentId: agent.id, stateRevision: snapshot.revision, cursor: packet.cursor, deliveryMode: 'frakio_full', budget: packet.budget, included, excluded: [], conflicts: packet.conflicts, warnings, sourceReceiptIds: packet.sourceReceiptIds }) : null;
  if (receipt) packet.contextReceiptId = receipt.id;
  return { packet, receipt, snapshot };
}

export function contextPacketPreview(packet) {
  return {
    schemaVersion: packet.schemaVersion,
    packetId: packet.packetId,
    packetHash: packet.packetHash,
    runtimeId: packet.runtimeId,
    targetAgentId: packet.targetAgentId,
    cursor: packet.cursor,
    budget: packet.budget,
    sources: [
      { kind: 'thread_state', label: '共享会话状态', count: Object.values(packet.sharedState || {}).flat().filter((item) => item.status === 'active').length },
      { kind: 'recent_conversation', label: '最近公开对话', count: packet.recentConversation?.length || 0 },
      { kind: 'relevant_history', label: '相关历史', count: packet.relevantHistory?.length || 0 },
      { kind: 'memory', label: '记忆', count: packet.memory?.length || 0 },
      ...(packet.personalVault ? [{ kind: 'personal_vault', label: packet.personalVault.name, count: packet.personalKnowledge?.length || 0 }] : []),
      ...(packet.vault ? [{ kind: 'project_rules', label: `${packet.vault.name} · 受信任规则`, count: packet.projectRules?.length || 0 }, { kind: 'project_reference', label: `${packet.vault.name} · 检索资料`, count: packet.projectKnowledge?.length || 0 }] : []),
      { kind: 'artifact', label: '产物引用', count: packet.artifactReferences?.length || 0 },
    ],
    conflicts: packet.conflicts || [],
    warnings: packet.warnings || [],
    projectRulePaths: (packet.projectRules || []).map((rule) => rule.relativePath),
    retrievedPaths: [...(packet.personalKnowledge || []), ...(packet.projectKnowledge || [])].map((item) => item.relativePath),
  };
}

export function renderContextPacketV2(packet) {
  if (packet?.schemaVersion !== 2) return '';
  const state = Object.entries(packet.sharedState || {}).flatMap(([kind, items]) => (items || []).filter((item) => item.status === 'active').map((item) => `- [${kind}/${item.authority}] ${item.statement} (sources: ${(item.sourceMessageIds || []).join(', ') || 'system'})`)).join('\n') || '- None';
  const handoff = packet.handoff ? `Objective: ${packet.handoff.objective}\nRequested output: ${packet.handoff.requestedOutput}\nSource message: ${packet.handoff.sourceMessageId}` : '- None';
  const history = [...(packet.relevantHistory || []), ...(packet.recentConversation || [])].map((item) => `- [${item.messageId} ${item.agentName || item.agentId}] ${item.content}`).join('\n') || '- None';
  const conflicts = (packet.conflicts || []).map((item) => `- ${item.reason} (${(item.stateItemIds || []).join(', ')})`).join('\n') || '- None';
  return `
Shared thread state (original source events remain authoritative):
${state}

Current structured handoff:
${handoff}

Relevant and recent public conversation:
${history}

Unresolved context conflicts:
${conflicts}
`;
}

import type {
  AgentProviderAdapter,
  SDKUserMessageInput,
  SendQueuedMessageOptions,
} from '@proma/shared'

const RUNTIME_QUEUE_READY_TIMEOUT_MS = 10_000
const RUNTIME_QUEUE_READY_POLL_MS = 25

function runtimeQueueIsStarting(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('尚未打开')
    || message.includes('is not active')
}

/**
 * 将队列消息交给当前 Runtime 原子处理。
 *
 * “立即发送”必须由 Runtime 自己执行 steering，不能由编排层先中断当前 Turn，
 * 再以普通 follow-up 发送，否则中断完成与消息注入之间会产生竞态。
 *
 * Renderer 的运行态会略早于 Runtime Session/Turn 就绪。用户若在启动窗口内点击
 * “立即发送”，这里等待适配器完成初始化，而不是把短暂的未就绪暴露成发送异常。
 */
export async function deliverQueuedMessageToRuntime(
  adapter: AgentProviderAdapter,
  sessionId: string,
  message: SDKUserMessageInput,
  options: SendQueuedMessageOptions,
): Promise<void> {
  if (!adapter.sendQueuedMessage) {
    throw new Error('[Agent 编排] 当前适配器不支持流式追加消息')
  }

  const deadline = Date.now() + RUNTIME_QUEUE_READY_TIMEOUT_MS
  while (true) {
    try {
      await adapter.sendQueuedMessage(sessionId, message, options)
      return
    } catch (error) {
      if (!runtimeQueueIsStarting(error) || Date.now() >= deadline) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, RUNTIME_QUEUE_READY_POLL_MS))
    }
  }
}

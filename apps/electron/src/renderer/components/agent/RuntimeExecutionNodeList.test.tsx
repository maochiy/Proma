import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionExecutionNode } from '@/lib/session-execution-nodes'
import {
  RuntimeExecutionNodeList,
  runtimeExecutionNodeStatusLabel,
} from './RuntimeExecutionNodeList'

const DETACHED_NODE: SessionExecutionNode = {
  id: 'monitor-node',
  kind: 'shell',
  name: '日志监控',
  description: '持续观察日志',
  status: 'running',
  transcriptAvailable: false,
  source: 'runtime',
  turnCompletionPolicy: 'detach',
}

describe('运行时执行节点列表', () => {
  test('Given 长期监控节点仍在运行 When 父 Turn 已结束 Then 标签显示等待指示', () => {
    expect(runtimeExecutionNodeStatusLabel(
      'running',
      false,
      true,
    )).toBe('正在等待指示')
  })

  test('Given detach 节点 When 渲染节点列表 Then 不显示执行中旋转图标', () => {
    const html = renderToStaticMarkup(
      <RuntimeExecutionNodeList
        nodes={[DETACHED_NODE]}
        isNodeRunning={() => false}
        onOpenNode={() => undefined}
      />,
    )

    expect(html).toContain('正在等待指示')
    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('正在运行')
  })
})

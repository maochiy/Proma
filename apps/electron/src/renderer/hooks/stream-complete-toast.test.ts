import { describe, expect, test } from 'bun:test'
import { shouldShowStreamCompleteToast, streamCompleteToastMessage } from './useGlobalAgentListeners'

describe('STREAM_COMPLETE Toast 去重', () => {
  test('Given 成功结果 When 判断是否弹 Toast Then 不弹', () => {
    expect(shouldShowStreamCompleteToast({ resultSubtype: 'success' })).toBe(false)
  })

  test('Given 用户主动停止 When 判断是否弹 Toast Then 不弹', () => {
    expect(shouldShowStreamCompleteToast({ resultSubtype: 'error_during_execution', stoppedByUser: true })).toBe(false)
  })

  test('Given error_during_execution 且 resultErrors 携带真实原因 When 判断 Then 不弹（避免与已展示错误重复）', () => {
    expect(shouldShowStreamCompleteToast({
      resultSubtype: 'error_during_execution',
      resultErrors: ['npm install 失败：网络超时'],
    })).toBe(false)
  })

  test('Given error_during_execution 但 resultErrors 为空 When 判断 Then 弹 Toast 兜底', () => {
    expect(shouldShowStreamCompleteToast({
      resultSubtype: 'error_during_execution',
      resultErrors: [],
    })).toBe(true)
  })

  test('Given 达到轮次上限 When 判断 Then 弹 Toast', () => {
    expect(shouldShowStreamCompleteToast({ resultSubtype: 'error_max_turns' })).toBe(true)
  })

  test('Given error_max_turns When 生成文案 Then 返回轮次上限提示', () => {
    expect(streamCompleteToastMessage({ resultSubtype: 'error_max_turns' })).toContain('轮次上限')
  })

  test('Given error_during_execution 无 resultErrors When 生成文案 Then 使用兜底文案', () => {
    expect(streamCompleteToastMessage({ resultSubtype: 'error_during_execution' })).toBe('任务执行过程中发生错误。')
  })

  test('Given 未知 subtype When 生成文案 Then 使用泛化兜底', () => {
    expect(streamCompleteToastMessage({ resultSubtype: 'weird_failure' })).toBe('任务异常结束（weird_failure）')
  })
})

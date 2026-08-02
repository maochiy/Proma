import { describe, expect, test } from 'bun:test'
import {
  computeSessionFloatingLayout,
  resolveSessionFloatingPanelToggle,
  shouldInvalidateSessionFloatingPanelForce,
} from './session-floating-layout'

describe('会话悬浮面板布局', () => {
  test('Given 宽屏空间充足 When 计算布局 Then 正文保持居中且显示悬浮面板', () => {
    const result = computeSessionFloatingLayout({
      viewportWidth: 1800,
      contentWidth: 800,
    })

    expect(result.visible).toBe(true)
    expect(result.contentOffsetX).toBe(0)
    expect(result.contentPanelGap).toBeGreaterThanOrEqual(80)
  })

  test('Given 中等宽度 When 居中正文会侵入面板安全区 Then 正文整体左移', () => {
    const result = computeSessionFloatingLayout({
      viewportWidth: 1380,
      contentWidth: 800,
      wasVisible: true,
    })

    expect(result.visible).toBe(true)
    expect(result.contentOffsetX).toBeLessThan(0)
    expect(result.contentPanelGap).toBe(80)
  })

  test('Given 空间不足 When 左移后左边距过小 Then 自动隐藏并恢复正文居中', () => {
    const result = computeSessionFloatingLayout({
      viewportWidth: 1000,
      contentWidth: 800,
      wasVisible: true,
    })

    expect(result).toEqual({
      visible: false,
      contentOffsetX: 0,
      contentPanelGap: 0,
    })
  })

  test('Given 空间不足且面板被自动隐藏 When 用户主动点击显示 Then 允许覆盖正文并强制显示', () => {
    const result = computeSessionFloatingLayout({
      viewportWidth: 1000,
      contentWidth: 800,
      wasVisible: false,
      forceVisible: true,
    })

    expect(result.visible).toBe(true)
    expect(result.contentOffsetX).toBe(0)
    expect(result.contentPanelGap).toBeLessThan(0)
  })

  test('Given 面板当前隐藏 When 宽度只达到隐藏阈值 When 计算布局 Then 使用回差保持隐藏', () => {
    const hidden = computeSessionFloatingLayout({
      viewportWidth: 1220,
      contentWidth: 800,
      wasVisible: false,
    })
    const visible = computeSessionFloatingLayout({
      viewportWidth: 1220,
      contentWidth: 800,
      wasVisible: true,
    })

    expect(hidden.visible).toBe(false)
    expect(visible.visible).toBe(true)
  })

  test('Given 用户偏好开启但面板被自动隐藏 When 点击顶部图标 Then 改为强制显示而不是关闭偏好', () => {
    const result = resolveSessionFloatingPanelToggle({
      enabled: true,
      actuallyVisible: false,
    })

    expect(result).toEqual({
      enabled: true,
      forceVisible: true,
    })
  })

  test('Given 面板正在显示 When 点击顶部图标 Then 正常隐藏并取消强制显示', () => {
    const result = resolveSessionFloatingPanelToggle({
      enabled: true,
      actuallyVisible: true,
    })

    expect(result).toEqual({
      enabled: false,
      forceVisible: false,
    })
  })

  test('Given 用户在空间不足时强制显示 When 会话视口宽度变化 Then 释放强制状态并恢复自动布局', () => {
    expect(shouldInvalidateSessionFloatingPanelForce({
      forcedAtViewportWidth: 1000,
      viewportWidth: 700,
    })).toBe(true)
  })

  test('Given 用户在空间不足时强制显示 When 会话视口宽度未变化 Then 继续显示避免点击无反馈', () => {
    expect(shouldInvalidateSessionFloatingPanelForce({
      forcedAtViewportWidth: 1000,
      viewportWidth: 1000,
    })).toBe(false)
  })
})

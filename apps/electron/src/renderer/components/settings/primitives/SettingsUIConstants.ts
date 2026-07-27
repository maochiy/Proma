/**
 * SettingsUIConstants - 设置界面统一样式 token
 *
 * 集中管理设置组件中使用的 Tailwind class，
 * 确保所有设置页面保持一致的视觉语言。
 */

/** 标签样式 */
export const LABEL_CLASS = 'text-[13px] font-medium text-foreground'

/** 描述文字样式 */
export const DESCRIPTION_CLASS = 'text-[12px] leading-5 text-muted-foreground'

/** 区块标题样式 */
export const SECTION_TITLE_CLASS = 'text-[14px] font-semibold text-foreground'

/** 区块描述样式 */
export const SECTION_DESCRIPTION_CLASS = 'mt-1 text-[12px] leading-5 text-muted-foreground'

/** 卡片容器样式 - 只有默认深色主题用透明，其他都用卡片背景 */
export const CARD_CLASS = 'overflow-hidden rounded-lg border border-border/55 bg-background/45 settings-card'

/** 卡片内行样式 */
export const ROW_CLASS = 'flex min-h-[52px] items-center justify-between px-4 py-3'

/** 卡片内分隔线样式 */
export const DIVIDER_CLASS = 'border-border/40'

/**
 * Proma Pi Runtime 适配器。
 *
 * 实现暂时复用迁移层中的 Bridge 代码；对外使用 Proma 命名，旧文件仅作为
 * 兼容入口保留，避免已有用户的 Runtime 配置和测试失效。
 */

import { FrakioPiRuntimeAdapter } from './frakio-pi-runtime-adapter'

export class PiRuntimeAdapter extends FrakioPiRuntimeAdapter {}

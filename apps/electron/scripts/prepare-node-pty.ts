import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { ensureNodePtySpawnHelperExecutable } from '../src/main/lib/integrated-terminal-utils'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('node-pty/package.json'))
const helperPath = ensureNodePtySpawnHelperExecutable(packageRoot)

if (helperPath) {
  console.log(`[集成终端] 已确认 spawn-helper 可执行: ${helperPath}`)
}

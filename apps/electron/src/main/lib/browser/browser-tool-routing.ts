const NATIVE_BROWSER_MCP_PREFIXES = [
  'mcp__claude-in-chrome__',
  'mcp__claude_in_chrome__',
  'mcp__playwright__',
] as const

const COMPUTER_USE_MCP_PREFIXES = [
  'mcp__computer-use__',
  'mcp__computer_use__',
] as const

const BROWSER_APPLICATION_PATTERNS = [
  /\bgoogle chrome\b/i,
  /\bchrome\b/i,
  /\bchromium\b/i,
  /\bsafari\b/i,
  /\bmicrosoft edge\b/i,
  /\bedge\b/i,
  /\bfirefox\b/i,
  /\bbrave\b/i,
  /\bopera\b/i,
  /\bvivaldi\b/i,
  /\barc\b/i,
  /com\.apple\.safari/i,
  /com\.google\.chrome/i,
  /com\.microsoft\.edgemac/i,
  /org\.mozilla\.firefox/i,
  /com\.brave\.browser/i,
  /company\.thebrowser\.browser/i,
] as const

function browserApplicationRequested(input: Record<string, unknown>): boolean {
  const candidates: string[] = []
  for (const key of ['bundle_id', 'bundleId', 'application', 'app', 'name']) {
    if (typeof input[key] === 'string') candidates.push(input[key])
  }
  if (Array.isArray(input.apps)) {
    for (const app of input.apps) {
      if (typeof app === 'string') {
        candidates.push(app)
        continue
      }
      if (!app || typeof app !== 'object' || Array.isArray(app)) continue
      const record = app as Record<string, unknown>
      for (const key of ['displayName', 'bundleId', 'bundle_id', 'name']) {
        if (typeof record[key] === 'string') candidates.push(record[key])
      }
    }
  }
  return candidates.some((candidate) => (
    BROWSER_APPLICATION_PATTERNS.some((pattern) => pattern.test(candidate))
  ))
}

/**
 * 阻止 Runtime 自带工具绕开 Proma 内置浏览器。
 *
 * Computer Use 仍可控制非网页桌面应用；只有申请或打开浏览器应用时拒绝，
 * 避免误伤用户明确要求的原生桌面自动化任务。
 */
export function nativeBrowserToolDenial(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (NATIVE_BROWSER_MCP_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    return 'Runtime 原生浏览器自动化已禁用。请改用 Proma 内置 mcp__browser__browser_* 工具，并先调用 browser_get_state 读取页面。'
  }

  if (!COMPUTER_USE_MCP_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    return undefined
  }
  if (!browserApplicationRequested(input)) return undefined

  return 'Computer Use 不允许控制 Chrome、Safari、Edge、Firefox 等浏览器应用。网页任务请改用 Proma 内置 mcp__browser__browser_* 工具。'
}

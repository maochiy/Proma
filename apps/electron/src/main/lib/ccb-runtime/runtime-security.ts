const SYSTEM_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'SHELL',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
])

const SAFE_ENVIRONMENT_PREFIXES = [
  'LC_',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]

/**
 * Utility Host 不需要 Provider 凭证。凭证仅通过 Session options 发送到目标 Worker，
 * 避免 Host/其它 Session 意外继承主进程中的 secret。
 */
export function buildCcbHostEnvironment(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (
      SYSTEM_ENVIRONMENT_KEYS.has(name) ||
      SAFE_ENVIRONMENT_PREFIXES.some(
        prefix => name === prefix || name.startsWith(prefix),
      )
    ) {
      result[name] = value
    }
  }
  return result
}

const SESSION_ENVIRONMENT_KEYS = new Set([
  ...SYSTEM_ENVIRONMENT_KEYS,
  'PROMA_CLI',
  'CLAUDE_CODE_SHELL',
  'PROMA_WINDOWS_SHELL',
  'PROMA_WSL_DISTRO',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
])

const SESSION_ENVIRONMENT_PREFIXES = [
  ...SAFE_ENVIRONMENT_PREFIXES,
  'CLAUDE_CODE_',
  'ANTHROPIC_',
  'OPENAI_',
  'AZURE_',
  'AWS_',
  'GOOGLE_',
  'GEMINI_',
]

export function sanitizeCcbSessionEnvironment(
  source: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(source ?? {})) {
    if (value === undefined) continue
    if (
      SESSION_ENVIRONMENT_KEYS.has(name) ||
      SESSION_ENVIRONMENT_PREFIXES.some(prefix => name.startsWith(prefix))
    ) {
      result[name] = value
    }
  }
  return result
}

/**
 * 计划执行阶段判定。
 *
 * 不依赖用户输入文案，而是观察 Agent 是否真正开始调用实施工具。
 * 只有已生成待执行计划时，首个实际工具调用才触发自动退出计划模式。
 */

const PLAN_NON_EXECUTION_TOOLS = new Set([
  // 这些工具只改变计划阶段或等待用户输入，不代表计划已经开始执行。
  'askuserquestion',
  'enterplanmode',
  'exitplanmode',
  // 仅维护任务元数据时还没有开始执行具体步骤。
  'todoread',
  'todowrite',
  'taskoutput',
  'taskcreate',
  'taskupdate',
  'tasklist',
  'taskget',
])

/** 判断 Bash 命令在计划模式下是否允许只读执行。 */
export function isPlanModeBashReadOnly(command: string): boolean {
  if (/(?<![0-9&])>/.test(command)) return false
  if (/\b(rm|rmdir)\s/.test(command)) return false
  if (/\bsed\s+[^|&;]*-i/.test(command)) return false
  if (/\b(chmod|chown|chattr|truncate)\s/.test(command)) return false
  if (/\b(mv|cp)\s/.test(command)) return false
  if (/\b(mkdir|touch|mktemp)\s/.test(command)) return false
  if (/\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update|upgrade|link|unlink)\b/.test(command)) return false
  if (/\bpip[23]?\s+(install|uninstall|upgrade)\b/.test(command)) return false
  if (/\b(apt|apt-get|brew|yum|dnf)\s+(install|remove|purge|uninstall|upgrade)\b/.test(command)) return false
  if (/\bgit\s+(commit|push|checkout\s+-[bB]|branch\s+-[mMdD]|merge\b|rebase\b|reset\b|stash\s+(drop|pop)\b|add\b|apply\b|cherry-pick\b)/.test(command)) return false
  if (/\b(kill|killall|pkill)\s/.test(command)) return false
  if (/\b(node|python[23]?|ruby|perl|php)\s+[^-]/.test(command)) return false
  return true
}

/**
 * 判断工具调用是否代表“开始按计划实施”。
 *
 * 计划是否已经生成由调用方的 planReady 状态保证，因此这里不能再把
 * Read/Glob/Grep/ls/find/只读 Bash 等工具当成“仍在规划”：实际执行计划时，
 * 第一步通常就是重新读取代码或检查环境。这里只排除纯计划控制、用户交互
 * 和任务元数据工具，其余工具一旦真正获准或启动，都视为计划开始执行。
 */
export function isPlanExecutionTool(toolName: string): boolean {
  return !PLAN_NON_EXECUTION_TOOLS.has(toolName.toLowerCase())
}

/** 判断实施工具获批或启动后，是否应正式退出计划模式。 */
export function shouldFinalizePlanExecution(input: {
  planModeEntered: boolean
  planReady: boolean
  toolName: string
}): boolean {
  return input.planModeEntered
    && input.planReady
    && isPlanExecutionTool(input.toolName)
}

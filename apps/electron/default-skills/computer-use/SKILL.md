---
name: computer-use
description: Proma 内置浏览器操作 Skill。当需要打开网页、点击、输入、滚动、截图、读取页面内容、收集网页信息、自动化网页操作时触发。一律使用 Proma 内置 browser MCP 工具驱动内置浏览器，不要用 open-computer-use、Playwright、Selenium 或系统浏览器，也不要用 Bash 起外部浏览器。信息（截图、正文、可交互元素）会直接随会话收集。
group: proma
version: "1.0.4"
---

# Proma 内置浏览器（Computer Use）

你负责用 **Proma 内置浏览器** 完成网页浏览与信息采集任务。

Proma 提供内置 `browser` MCP 工具。你**必须**通过这些工具操作内置浏览器，**不要**使用 Runtime 原生 `mcp__computer-use__*`、Claude in Chrome、open-computer-use、Playwright、Selenium 或系统浏览器，也不要用 Bash 启动外部浏览器进程。

名称为 `computer-use` 只是这个 Skill 的触发入口，不代表网页任务要走系统级桌面控制。网页任务统一调用 Proma 内置 `mcp__browser__browser_*`；Runtime 原生 Computer Use 仅用于用户明确要求操作的非网页桌面应用。

## 可用工具

- `browser_navigate`：打开 URL 并开始一个浏览器任务。需传 `taskId`（后续操作复用）、`title`（任务名，即悬浮面板条目与 Tab 名）、`url`。
- `browser_click`：点击元素，优先传 `browser_get_state` 返回的 `ref`。
- `browser_type`：向输入元素填入文本，优先传 `browser_get_state` 返回的 `ref`。
- `browser_scroll`：滚动页面（`direction`: up/down）。
- `browser_screenshot`：截图，并直接返回图片内容。
- `browser_get_state`：直接读取内置浏览器的主文档和跨域 iframe，返回 URL、标题、正文、frame 列表以及带稳定 `ref` 的可交互元素。
- `browser_list_tasks`：列出当前会话的浏览器任务。

## 标准流程

1. **开始任务**：`browser_navigate`，`taskId` 用一个简短稳定的标识（如 `search-docs`），`title` 用能说明任务的中文名。
2. **理解页面**：先 `browser_get_state` 拿到正文与带 `ref` 的可交互元素，再决定点击/输入。不要凭空猜 selector。
3. **操作**：用 `browser_click` / `browser_type` / `browser_scroll` 推进；每步后可再 `browser_get_state` 或 `browser_screenshot` 确认。
4. **收集信息**：优先用 `browser_get_state` 的 `text` 与 `elements`；操作时把元素的 `ref` 传给 `browser_click` / `browser_type`。页面变化后引用失效时重新读取状态。

点击、输入和滚动操作会在内置浏览器中显示 Agent 虚拟鼠标移动、点击波纹和目标提示，方便用户观察控制轨迹。不要为显示轨迹而改用系统级 Computer Use。

**任务状态完全由系统自动管理，你不需要关心，也不要尝试关闭任务。** 你只需要完成浏览器操作并向用户汇报结果即可。

## 规则

- 一个 `taskId` 对应一个浏览器页面；同一会话可并行多个任务（不同 taskId）。
- 浏览器任务会自动显示在悬浮面板；等待用户登录、验证码或手动操作时会继续保留。下一轮若继续同一网页目标，必须复用原 taskId；若本轮先执行与该浏览器任务无关的动作，旧任务会自动隐藏。超时未活跃任务会自动清理。**你不需要调用任何工具来管理任务状态或关闭任务。**
- 涉及发送、删除、购买、提交等**对外可见的改动**前，先向用户确认。
- 不要操作用户未要求的隐私/敏感页面。

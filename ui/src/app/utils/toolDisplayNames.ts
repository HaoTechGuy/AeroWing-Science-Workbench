const TOOL_DISPLAY_NAMES: Record<string, string> = {
  "general-purpose": "通用科研助手",
  general_purpose: "通用科研助手",
  task: "调用子助手",
  execute: "执行命令",
  write_todos: "更新待办",
  write_todo: "更新待办",
  writetodo: "更新待办",
  writetodos: "更新待办",
  writeTodo: "更新待办",
  writeTodos: "更新待办",
  "write-todos": "更新待办",
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  ls: "查看目录",
  glob: "搜索文件",
  grep: "搜索文本",
  compact_conversation: "压缩上下文",
  start_async_task: "启动后台任务",
  check_async_task: "检查后台任务",
  update_async_task: "更新后台任务",
  cancel_async_task: "取消后台任务",
  list_async_tasks: "列出后台任务",
};

function normalizeToolName(name: string): string {
  return name.trim();
}

export function getToolDisplayName(name?: string | null): string {
  if (!name) return "未知工具";

  const normalizedName = normalizeToolName(name);
  return (
    TOOL_DISPLAY_NAMES[normalizedName] ??
    TOOL_DISPLAY_NAMES[normalizedName.toLowerCase()] ??
    normalizedName
  );
}

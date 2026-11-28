import { asObject, base, classifyCommand, fileChange, str, type Adapter, type DraftEvent } from "./common";

const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Claude Code command hooks. Field names checked against Claude Code 2.1.332
 * (fixtures in `claude-code/fixtures/`).
 */
export const claudeCode: Adapter = {
  tool: "claude-code",
  hookEvents: [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "Stop",
    "Notification",
    "PostToolUse",
    "PostToolUseFailure",
  ],
  convert(raw, ctx) {
    const p = asObject(raw);
    const session = p && str(p.session_id);
    if (!p || !session) return null;
    const b = (id?: string) => base(ctx, "claude-code", session, p, id);
    const toolUseId = str(p.tool_use_id);
    const toolId = toolUseId ? `claude-code:${session}:${toolUseId}` : undefined;
    const one = (e: DraftEvent | null) => ({ session, events: e ? [e] : [] });

    switch (p.hook_event_name) {
      case "SessionStart":
        return one({ ...b(), kind: "session.start", data: {} });
      case "SessionEnd":
        return one({ ...b(), kind: "session.end", data: { reason: str(p.reason)?.slice(0, 100) } });
      case "UserPromptSubmit":
        return one({ ...b(), kind: "turn.start", data: {} });
      case "Stop":
        return one({ ...b(), kind: "turn.end", data: {} });
      case "Notification":
        // Sent when Claude Code waits for the user (permission prompt or idle input).
        return one({ ...b(), kind: "session.idle", data: {} });
      case "PostToolUse":
      case "PostToolUseFailure": {
        const name = str(p.tool_name);
        const input = asObject(p.tool_input) ?? {};
        const ok = p.hook_event_name === "PostToolUse";
        if (name === "Bash") {
          const command = str(input.command) ?? "";
          return one({ ...b(toolId), kind: "command.run", data: { category: classifyCommand(command), ok } });
        }
        if (name && FILE_TOOLS.has(name) && ok) {
          const target = str(input.file_path) ?? str(input.notebook_path);
          return one(target ? fileChange(ctx, b(toolId), [target]) : null);
        }
        return one(null);
      }
      default:
        return null;
    }
  },
};

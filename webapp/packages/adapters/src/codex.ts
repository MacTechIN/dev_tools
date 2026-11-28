import { asObject, base, classifyCommand, fileChange, patchPaths, str, type Adapter, type DraftEvent } from "./common";

/** Exit status from a Codex tool response, if it reports one. */
function exitOk(response: unknown): boolean | undefined {
  const r = asObject(response);
  if (!r) return undefined;
  for (const key of ["exit_code", "exitCode"]) {
    const v = r[key];
    if (typeof v === "number") return v === 0;
  }
  return undefined;
}

function patchText(input: unknown): string | undefined {
  if (typeof input === "string") return input.includes("*** Begin Patch") ? input : undefined;
  const o = asObject(input);
  if (!o) return undefined;
  for (const key of ["input", "patch"]) {
    const v = o[key];
    if (typeof v === "string" && v.includes("*** Begin Patch")) return v;
  }
  return undefined;
}

/**
 * Codex CLI command hooks. Session, prompt and session-end payloads were checked
 * against Codex 0.166.0; tool payloads follow the input schemas bundled in that
 * version (`codex/fixtures/schemas-0.166.0/`). Codex can run every action through
 * one generic tool, so file changes come from a git scan at the end of each turn.
 */
export const codex: Adapter = {
  tool: "codex",
  hookEvents: ["SessionStart", "SessionEnd", "UserPromptSubmit", "PermissionRequest", "PostToolUse", "Stop", "Interrupt"],
  convert(raw, ctx) {
    const p = asObject(raw);
    const session = p && str(p.session_id);
    if (!p || !session) return null;
    const b = (id?: string) => base(ctx, "codex", session, p, id);
    const one = (e: DraftEvent | null) => ({ session, events: e ? [e] : [] });

    switch (p.hook_event_name) {
      case "SessionStart":
        return one({ ...b(), kind: "session.start", data: {} });
      case "SessionEnd":
        return one({ ...b(), kind: "session.end", data: { reason: str(p.reason)?.slice(0, 100) } });
      case "UserPromptSubmit":
        return { ...one({ ...b(), kind: "turn.start", data: {} }), scan: "begin" };
      case "Stop":
      case "Interrupt":
        return { ...one({ ...b(), kind: "turn.end", data: {} }), scan: "end" };
      case "PermissionRequest":
        return one({ ...b(), kind: "session.idle", data: {} });
      case "PostToolUse": {
        const toolUseId = str(p.tool_use_id);
        const id = toolUseId ? `codex:${session}:${toolUseId}` : undefined;
        const patch = patchText(p.tool_input);
        if (patch) return one(fileChange(ctx, b(id), patchPaths(patch)));
        const input = asObject(p.tool_input);
        const command = input?.command;
        if (typeof command === "string" || (Array.isArray(command) && command.every((c) => typeof c === "string"))) {
          const ok = exitOk(p.tool_response);
          return one({
            ...b(id),
            kind: "command.run",
            data: { category: classifyCommand(command as string | string[]), ...(ok === undefined ? {} : { ok }) },
          });
        }
        return one(null);
      }
      default:
        return null;
    }
  },
};

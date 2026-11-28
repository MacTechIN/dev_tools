import type { Tool } from "@devtools/shared";
import { claudeCode } from "./claude-code";
import { codex } from "./codex";
import type { Adapter } from "./common";

export * from "./common";
export { claudeCode, codex };

/** Adapters by tool. Adding a tool means adding an entry here, not changing the server (REQ-NFR-006). */
export const ADAPTERS: Partial<Record<Tool, Adapter>> = {
  "claude-code": claudeCode,
  codex,
};

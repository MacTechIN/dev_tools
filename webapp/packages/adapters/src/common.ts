import path from "node:path";
import type { Tool, ToolEvent } from "@devtools/shared";

/** An event before the runner adds the branch. */
export type DraftEvent = Omit<ToolEvent, "branch">;

export interface ConvertContext {
  /** Absolute path of the connected project's root. */
  root: string;
  now(): string;
  newId(): string;
}

export interface Converted {
  session: string;
  events: DraftEvent[];
  /**
   * Asks the runner to find changed files with git: "begin" records file
   * signatures at the start of a turn, "end" reports what changed since.
   * Used for tools whose tool events do not say which files were edited.
   */
  scan?: "begin" | "end";
}

export interface Adapter {
  tool: Tool;
  /** Hook event names the connect command registers. */
  hookEvents: readonly string[];
  /** Returns null for payloads the adapter ignores. Never throws on bad input. */
  convert(payload: unknown, ctx: ConvertContext): Converted | null;
}

export type Payload = Record<string, unknown>;

export function asObject(v: unknown): Payload | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : null;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Path relative to the project root in POSIX form, or null if it is outside the project. */
export function relPath(root: string, p: string): string | null {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel === "") return ".";
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

const TEST_RE =
  /(^|[\s;&|(])(vitest|jest|pytest|mocha|ava|phpunit|rspec|playwright\s+test|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\w*\s+test|(npm|pnpm|yarn|bun)\s+(run\s+)?test)\b/;
const BUILD_RE =
  /(^|[\s;&|(])(tsc|tsup|webpack|esbuild|vite\s+build|next\s+build|make|cmake|go\s+build|cargo\s+build|dotnet\s+build|mvn\s+(package|install)|gradle\w*\s+(build|assemble)|docker\s+build|(npm|pnpm|yarn|bun)\s+(run\s+)?build)\b/;

/**
 * Sorts a shell command into test, build or other. Only the category leaves the
 * computer; the command text itself is never sent (REQ-COL-006).
 */
export function classifyCommand(command: string | readonly string[]): "test" | "build" | "other" {
  const text = typeof command === "string" ? command : command.join(" ");
  if (TEST_RE.test(text)) return "test";
  if (BUILD_RE.test(text)) return "build";
  return "other";
}

/** File paths named in an apply_patch body (`*** Add File: x`, `*** Update File: x`, `*** Move to: x`). */
export function patchPaths(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
    const p = m[1]?.trim();
    if (p) out.push(p);
  }
  return out;
}

export function base(
  ctx: ConvertContext,
  tool: Tool,
  session: string,
  payload: Payload,
  id?: string,
): Pick<DraftEvent, "id" | "tool" | "session" | "at" | "cwd"> {
  const cwd = str(payload.cwd);
  const rel = cwd ? relPath(ctx.root, cwd) : null;
  return {
    id: id ?? `${tool}:${session}:${ctx.newId()}`,
    tool,
    session,
    at: ctx.now(),
    ...(rel ? { cwd: rel } : {}),
  };
}

export function fileChange(
  ctx: ConvertContext,
  b: ReturnType<typeof base>,
  paths: readonly string[],
): DraftEvent | null {
  const rel = [...new Set(paths.map((p) => relPath(ctx.root, p)).filter((p): p is string => p !== null && p !== "."))];
  if (rel.length === 0) return null;
  return { ...b, kind: "file.change", data: { paths: rel.slice(0, 200) } };
}

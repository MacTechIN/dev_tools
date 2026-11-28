import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADAPTERS } from "@devtools/adapters";
import type { Tool } from "@devtools/shared";

/** Marks hook entries this command added, so disconnect removes only those (REQ-ADM-005). */
export const MARKER = ": devtools-hook=1;";

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}
interface HookFile {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The shell command a hook runs. It ends with `|| :` so a missing Node.js never fails the tool's hook. */
export function hookCommand(tool: Tool, node: string, script: string): string {
  return `${MARKER} ${quote(node)} ${quote(script)} hook ${tool} || :`;
}

function readHookFile(file: string): HookFile {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as HookFile;
  } catch {
    // fall through
  }
  throw new Error(`설정 파일을 읽을 수 없습니다(JSON 형식이 아님): ${file}`);
}

function withoutOurs(groups: HookGroup[]): HookGroup[] {
  return groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !h.command?.includes(MARKER)) }))
    .filter((g) => g.hooks.length > 0);
}

/** Adds our hook to each event, keeping every existing entry. Running it again replaces only ours. */
export function addHooks(file: string, events: readonly string[], command: string) {
  const data = readHookFile(file);
  const hooks = { ...(data.hooks ?? {}) };
  for (const event of events) {
    hooks[event] = [...withoutOurs(hooks[event] ?? []), { hooks: [{ type: "command", command, timeout: 10 }] }];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...data, hooks }, null, 2) + "\n");
}

/** Removes only our entries. Deletes the file if nothing else was in it. Returns whether anything changed. */
export function removeHooks(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const data = readHookFile(file);
  if (!data.hooks) return false;
  const before = JSON.stringify(data.hooks);
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(data.hooks)) {
    const kept = withoutOurs(groups);
    if (kept.length > 0) hooks[event] = kept;
  }
  if (JSON.stringify(hooks) === before) return false;
  const { hooks: _drop, ...rest } = data;
  const next: HookFile = Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
  if (Object.keys(next).length === 0) fs.rmSync(file);
  else fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return true;
}

/**
 * Claude Code: the project's personal settings file, which is not shared through git.
 * Codex: the user's hooks file, because Codex has no personal per-project file; the hook
 * itself ignores projects that are not connected.
 */
export function hookFile(tool: Tool, root: string, env: NodeJS.ProcessEnv = process.env): string {
  if (tool === "claude-code") return path.join(root, ".claude", "settings.local.json");
  if (tool === "codex") return path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "hooks.json");
  throw new Error(`지원하지 않는 도구: ${tool}`);
}

export function installTool(tool: Tool, root: string, command: string, env: NodeJS.ProcessEnv = process.env): string {
  const adapter = ADAPTERS[tool];
  if (!adapter) throw new Error(`지원하지 않는 도구: ${tool}`);
  const file = hookFile(tool, root, env);
  addHooks(file, adapter.hookEvents, command);
  if (tool === "claude-code") ignoreLocally(root, ".claude/settings.local.json");
  return file;
}

/** Keeps a personal file out of commits without touching the shared .gitignore. */
function ignoreLocally(root: string, rel: string) {
  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", rel], { stdio: "ignore" });
    return; // already ignored
  } catch {
    // not ignored, or not a git repository
  }
  try {
    const gitDir = execFileSync("git", ["-C", root, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
    const exclude = path.resolve(root, gitDir);
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, `\n# devtools connect\n/${rel}\n`);
  } catch {
    // not a git repository: nothing to protect
  }
}

/** AI coding tools found on this computer's PATH. */
export function detectTools(): Tool[] {
  const found: Tool[] = [];
  for (const [tool, bin] of [
    ["claude-code", "claude"],
    ["codex", "codex"],
  ] as const) {
    try {
      execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
      found.push(tool);
    } catch {
      // not installed
    }
  }
  return found;
}

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ADAPTERS, fileChange, str, asObject, type DraftEvent } from "@devtools/adapters";
import type { Tool, ToolEvent } from "@devtools/shared";
import { findProject, loadConfig, writePrivate } from "./config";
import { changedSince, currentBranch, dirtySignatures, headCommit, ownCommit } from "./git";
import { enqueue } from "./queue";

interface ProjectState {
  branch?: string;
  head?: string;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

const key = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const stateFile = (home: string, root: string) => path.join(home, "state", `${key(root)}.json`);
const scanFile = (home: string, tool: Tool, session: string) => path.join(home, "scans", `${key(`${tool}:${session}`)}.json`);

export interface HookOptions {
  home: string;
  tool: string;
  input: string;
  now?: () => string;
}

/**
 * Handles one hook call: converts the tool's payload, adds git information,
 * and queues the result. It never sends anything itself and never throws, so the
 * AI tool is not slowed down or blocked (REQ-COL-011). Returns the queued events.
 */
export function runHook({ home, tool, input, now = () => new Date().toISOString() }: HookOptions): ToolEvent[] {
  const adapter = ADAPTERS[tool as Tool];
  const cfg = loadConfig(home);
  if (!adapter || !cfg) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    return [];
  }
  const cwd = str(asObject(payload)?.cwd);
  const project = cwd ? findProject(cfg, cwd) : undefined;
  // Codex hooks are installed per user, so calls from projects that are not connected end here.
  if (!project || !project.tools.includes(adapter.tool)) return [];
  const root = project.root;

  const converted = adapter.convert(payload, { root, now, newId: randomUUID });
  if (!converted) return [];
  const { session } = converted;
  const events: DraftEvent[] = [...converted.events];
  const extra = (kind: "git.branch" | "git.commit", data: object, id: string) =>
    ({ id, tool: adapter.tool, session, at: now(), kind, data }) as DraftEvent;

  // Branch switches and new commits (REQ-COL-005). Commits use their hash as the id, so a commit
  // seen from two sessions is stored once.
  const branch = currentBranch(root) ?? undefined;
  const head = headCommit(root) ?? undefined;
  const sf = stateFile(home, root);
  const prev = readJson<ProjectState>(sf) ?? {};
  if (branch && prev.branch && branch !== prev.branch) {
    events.push(extra("git.branch", { from: prev.branch.slice(0, 300), to: branch.slice(0, 300) }, `git.branch:${randomUUID()}`));
  } else if (head && prev.head && head !== prev.head) {
    const info = ownCommit(root, head);
    if (info) events.push(extra("git.commit", { hash: info.hash, subject: info.subject.slice(0, 300), paths: info.paths }, `git.commit:${info.hash}`));
  }
  if (branch !== prev.branch || head !== prev.head) writePrivate(sf, JSON.stringify({ branch, head }));

  // Tools whose tool events do not name edited files: compare git status at turn start and end.
  if (converted.scan === "begin") {
    writePrivate(scanFile(home, adapter.tool, session), JSON.stringify(dirtySignatures(root)));
  } else if (converted.scan === "end") {
    const file = scanFile(home, adapter.tool, session);
    const before = readJson<Record<string, string>>(file);
    if (before) {
      const changed = changedSince(before, dirtySignatures(root));
      const b = { id: `${adapter.tool}:${session}:${randomUUID()}`, tool: adapter.tool, session, at: now() };
      const ev = fileChange({ root, now, newId: randomUUID }, b, changed.map((p) => path.join(root, p)));
      if (ev) events.push(ev);
      fs.rmSync(file, { force: true });
    }
  }

  const out = events.map((e) => ({ ...e, ...(branch ? { branch: branch.slice(0, 300) } : {}) }) as ToolEvent);
  return enqueue(home, out) ? out : [];
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Tool } from "@devtools/shared";

/** Where the command keeps its token, queue and state. DEVTOOLS_HOME overrides it (tests). */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DEVTOOLS_HOME) return path.resolve(env.DEVTOOLS_HOME);
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "devtools");
}

export interface ProjectEntry {
  root: string;
  tools: Tool[];
}

export interface Config {
  version: 1;
  server: string;
  /** Device token. Only POST /api/events, GET /api/me and self-revoke accept it. */
  token: string;
  loginId: string;
  projects: ProjectEntry[];
}

const file = (home: string) => path.join(home, "config.json");

export function loadConfig(home: string): Config | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(file(home), "utf8")) as Config;
    return cfg.version === 1 && typeof cfg.token === "string" ? cfg : null;
  } catch {
    return null;
  }
}

/** Writes a file readable only by the owner, replacing it atomically. */
export function writePrivate(target: string, content: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function saveConfig(home: string, cfg: Config) {
  writePrivate(file(home), JSON.stringify(cfg, null, 2) + "\n");
}

export function removeConfig(home: string) {
  fs.rmSync(file(home), { force: true });
}

/** The connected project containing `dir`, preferring the deepest root. */
export function findProject(cfg: Config, dir: string): ProjectEntry | undefined {
  const abs = path.resolve(dir);
  return cfg.projects
    .filter((p) => abs === p.root || abs.startsWith(p.root.endsWith(path.sep) ? p.root : p.root + path.sep))
    .sort((a, b) => b.root.length - a.root.length)[0];
}

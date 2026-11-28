import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADAPTERS } from "@devtools/adapters";
import type { Tool } from "@devtools/shared";
import { loadConfig, removeConfig, saveConfig, type Config } from "./config";
import { projectRoot } from "./git";
import { detectTools, hookCommand, hookFile, installTool, removeHooks } from "./install";
import { M } from "./messages";

export class UserError extends Error {}

export interface ConnectOptions {
  home: string;
  server: string;
  /** Folder inside the project; its git root is used. */
  dir: string;
  tools?: Tool[];
  loginId?: string;
  password?: string;
  ask(question: string, hidden: boolean): Promise<string>;
  log(line: string): void;
  /** Node.js binary and installed script that hooks will run. */
  node: string;
  script: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

function normalizeServer(server: string): string {
  try {
    const u = new URL(server);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return u.origin;
  } catch {
    throw new UserError(M.badServer(server));
  }
}

async function call(fetchImpl: typeof fetch, server: string, pathname: string, init: RequestInit = {}) {
  try {
    return await fetchImpl(new URL(pathname, server), { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UserError(M.unreachable(server));
  }
}

async function me(fetchImpl: typeof fetch, server: string, token: string): Promise<{ name: string } | null> {
  const res = await call(fetchImpl, server, "/api/me", { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { me: { name: string } }).me;
}

/** Logs in once and returns a new device token. The password is never stored (REQ-ADM-012). */
async function login(o: ConnectOptions, server: string): Promise<{ token: string; loginId: string }> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const loginId = o.loginId ?? (await o.ask(M.askLoginId, false)).trim();
  const password = o.password ?? (await o.ask(M.askPassword, true));
  const label = `${os.hostname()} (${os.userInfo().username})`.slice(0, 60);
  const res = await call(fetchImpl, server, "/api/device-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId, password, label }),
  });
  if (res.status === 401) throw new UserError(M.invalidCredentials);
  if (res.status === 429) throw new UserError(M.tooMany);
  if (res.status === 403) throw new UserError(M.mustChange);
  if (!res.ok) throw new UserError(M.loginFailed(res.status));
  const { token } = (await res.json()) as { token: string };
  return { token, loginId };
}

/**
 * Connects this computer's AI tools to the server for one project (REQ-ADM-001):
 * gets a device token, installs hooks next to existing ones, and checks the token.
 */
export async function connect(o: ConnectOptions): Promise<Config> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const server = normalizeServer(o.server);
  const root = projectRoot(o.dir) ?? path.resolve(o.dir);

  const tools = o.tools ?? detectTools();
  if (tools.length === 0) throw new UserError(M.noTools);
  for (const t of tools) if (!ADAPTERS[t]) throw new UserError(M.unknownTool(t));

  let cfg = loadConfig(o.home);
  if (cfg && cfg.server !== server) throw new UserError(M.otherServer(cfg.server));
  let profile = cfg ? await me(fetchImpl, server, cfg.token) : null;
  if (cfg && profile) o.log(M.reuseToken);
  if (cfg && !profile) o.log(M.tokenRevoked);
  if (!cfg || !profile) {
    const { token, loginId } = await login(o, server);
    cfg = { version: 1, server, token, loginId, projects: cfg?.projects ?? [] };
    profile = await me(fetchImpl, server, token);
    if (!profile) throw new UserError(M.unauthorized);
  }

  const command = (tool: Tool) => hookCommand(tool, o.node, o.script);
  const files = tools.map((t) => [t, installTool(t, root, command(t), o.env)] as const);
  const others = cfg.projects.filter((p) => p.root !== root);
  cfg.projects = [...others, { root, tools }];
  saveConfig(o.home, cfg);

  o.log(M.connected(profile.name, root));
  for (const [t, f] of files) o.log(M.installed(t, f));
  if (tools.includes("claude-code")) o.log(M.claudeRestart);
  if (tools.includes("codex")) o.log(M.codexTrust);
  return cfg;
}

export interface DisconnectOptions {
  home: string;
  dir: string;
  all: boolean;
  log(line: string): void;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** Undoes connect: removes only the hooks it added, and revokes the token when nothing stays connected (REQ-ADM-005). */
export async function disconnect(o: DisconnectOptions): Promise<void> {
  const cfg = loadConfig(o.home);
  if (!cfg) throw new UserError(M.notConnected);
  const root = projectRoot(o.dir) ?? path.resolve(o.dir);
  const leaving = o.all ? cfg.projects : cfg.projects.filter((p) => p.root === root);
  if (leaving.length === 0) throw new UserError(M.projectNotConnected(root));
  const staying = cfg.projects.filter((p) => !leaving.includes(p));

  for (const p of leaving) {
    if (p.tools.includes("claude-code")) removeHooks(hookFile("claude-code", p.root, o.env));
    o.log(M.disconnected(p.root));
  }
  // The Codex hooks file is shared by all projects on this computer.
  if (!staying.some((p) => p.tools.includes("codex")) && leaving.some((p) => p.tools.includes("codex"))) {
    removeHooks(hookFile("codex", root, o.env));
  }

  if (staying.length > 0) {
    saveConfig(o.home, { ...cfg, projects: staying });
    return;
  }
  try {
    const res = await (o.fetchImpl ?? fetch)(new URL("/api/device-tokens/self", cfg.server), {
      method: "DELETE",
      headers: { authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    // 401 means the token was already revoked from the web screen.
    if (!res.ok && res.status !== 401) throw new Error();
    o.log(M.allDisconnected);
  } catch {
    o.log(M.revokeFailed);
  }
  removeConfig(o.home);
  // Remove only what this command created, then the folder itself if it is now empty.
  for (const f of ["queue.jsonl", "inflight.jsonl", "flush.lock", "state", "scans", "bin"]) {
    fs.rmSync(path.join(o.home, f), { force: true, recursive: true });
  }
  try {
    fs.rmdirSync(o.home);
  } catch {
    // not empty or already gone
  }
}

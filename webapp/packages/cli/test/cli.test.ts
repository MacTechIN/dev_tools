import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfig, saveConfig, type Config } from "../src/config";
import { connect, disconnect } from "../src/connect";
import { runHook } from "../src/hook";
import { addHooks, MARKER, removeHooks } from "../src/install";
import { enqueue, flush, pendingCount } from "../src/queue";

let tmp: string;
let home: string;
let repo: string;

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devtools-cli-"));
  home = path.join(tmp, "home");
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "me@example.com");
  sh(repo, "config", "user.name", "Me");
  sh(repo, "commit", "-q", "--allow-empty", "-m", "init");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function config(tools: Config["projects"][number]["tools"] = ["claude-code", "codex"]): Config {
  const cfg: Config = { version: 1, server: "http://127.0.0.1:1", token: "t", loginId: "me", projects: [{ root: repo, tools }] };
  saveConfig(home, cfg);
  return cfg;
}

const claude = (event: string, extra: object = {}) =>
  JSON.stringify({ session_id: "s1", cwd: repo, hook_event_name: event, ...extra });
const codexPayload = (event: string, extra: object = {}) =>
  JSON.stringify({ session_id: "c1", cwd: repo, hook_event_name: event, turn_id: "t", model: "m", ...extra });

describe("hook", () => {
  test("REQ-COL-002, REQ-COL-005: queues converted events with the current branch", () => {
    config();
    sh(repo, "checkout", "-q", "-b", "req/REQ-TSK-003-claim");
    const out = runHook({ home, tool: "claude-code", input: claude("SessionStart") });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "session.start", tool: "claude-code", branch: "req/REQ-TSK-003-claim", cwd: "." });
    expect(pendingCount(home)).toBe(1);
  });

  test("REQ-COL-005: a branch switch and a new commit by me become git events", () => {
    config();
    runHook({ home, tool: "claude-code", input: claude("UserPromptSubmit") });
    sh(repo, "checkout", "-q", "-b", "feature");
    const switched = runHook({ home, tool: "claude-code", input: claude("Stop") });
    expect(switched.map((e) => e.kind)).toEqual(["turn.end", "git.branch"]);
    expect(switched[1]).toMatchObject({ data: { from: "main", to: "feature" } });

    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    sh(repo, "add", "a.txt");
    sh(repo, "commit", "-q", "-m", "Add a (REQ-COL-005)");
    const committed = runHook({ home, tool: "claude-code", input: claude("Stop") });
    const commit = committed.find((e) => e.kind === "git.commit");
    expect(commit).toMatchObject({ data: { subject: "Add a (REQ-COL-005)", paths: ["a.txt"] } });
    expect(commit?.id).toBe(`git.commit:${sh(repo, "rev-parse", "HEAD").trim()}`);
  });

  test("REQ-COL-005: a commit by someone else (pulled in) is not reported as mine", () => {
    config();
    runHook({ home, tool: "claude-code", input: claude("UserPromptSubmit") });
    sh(repo, "-c", "user.email=other@example.com", "commit", "-q", "--allow-empty", "-m", "theirs");
    const out = runHook({ home, tool: "claude-code", input: claude("Stop") });
    expect(out.map((e) => e.kind)).toEqual(["turn.end"]);
  });

  test("REQ-COL-003: Codex file changes come from comparing git status at turn start and end", () => {
    config();
    fs.writeFileSync(path.join(repo, "already-dirty.txt"), "x");
    fs.writeFileSync(path.join(repo, "untouched.txt"), "x");
    runHook({ home, tool: "codex", input: codexPayload("UserPromptSubmit", { prompt: "do it" }) });
    fs.writeFileSync(path.join(repo, "already-dirty.txt"), "changed during the turn");
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(path.join(repo, "src", "new.ts"), "new");
    const out = runHook({ home, tool: "codex", input: codexPayload("Stop", { last_assistant_message: "done" }) });
    const change = out.find((e) => e.kind === "file.change");
    expect(change?.data).toEqual({ paths: ["already-dirty.txt", "src/new.ts"] });
  });

  test("REQ-COL-011: calls from projects that are not connected, bad input and disconnected tools do nothing", () => {
    config(["claude-code"]);
    const elsewhere = JSON.stringify({ session_id: "s", cwd: tmp, hook_event_name: "SessionStart" });
    expect(runHook({ home, tool: "claude-code", input: elsewhere })).toEqual([]);
    expect(runHook({ home, tool: "claude-code", input: "not json" })).toEqual([]);
    expect(runHook({ home, tool: "codex", input: codexPayload("SessionStart") })).toEqual([]);
    expect(runHook({ home, tool: "nope", input: claude("SessionStart") })).toEqual([]);
    expect(pendingCount(home)).toBe(0);
  });

  test("REQ-COL-011: without a config the hook does nothing", () => {
    expect(runHook({ home, tool: "claude-code", input: claude("SessionStart") })).toEqual([]);
  });
});

describe("queue", () => {
  async function server(handler: (body: { events: unknown[] }) => number) {
    const received: unknown[] = [];
    const srv = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = JSON.parse(data) as { events: unknown[] };
        const status = handler(body);
        if (status === 200) received.push(...body.events);
        res.writeHead(status, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    return { url: `http://127.0.0.1:${port}`, received, close: () => new Promise((r) => srv.close(r)) };
  }

  test("REQ-COL-008: events wait on disk while the server is down and are sent later", async () => {
    const cfg = config();
    enqueue(home, [{ id: "1" }, { id: "2" }]);
    expect(await flush(home, cfg)).toBe("offline");
    expect(pendingCount(home)).toBe(2);

    let up = false;
    const srv = await server(() => (up ? 200 : 503));
    const live = { ...cfg, server: srv.url };
    expect(await flush(home, live)).toBe("offline");
    up = true;
    enqueue(home, [{ id: "3" }]);
    expect(await flush(home, live)).toBe("sent");
    expect(srv.received).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(pendingCount(home)).toBe(0);
    await srv.close();
  });

  test("REQ-COL-008: a rejected token keeps the events; a malformed batch is dropped", async () => {
    const cfg = config();
    let status = 401;
    const srv = await server(() => status);
    const live = { ...cfg, server: srv.url };
    enqueue(home, [{ id: "1" }]);
    expect(await flush(home, live)).toBe("unauthorized");
    expect(pendingCount(home)).toBe(1);
    status = 400;
    expect(await flush(home, live)).toBe("sent");
    expect(pendingCount(home)).toBe(0);
    await srv.close();
  });

  test("REQ-COL-008: only one flush runs at a time", async () => {
    const cfg = config();
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "flush.lock"), "123");
    enqueue(home, [{ id: "1" }]);
    expect(await flush(home, cfg)).toBe("busy");
  });
});

describe("install", () => {
  test("REQ-ADM-001, REQ-ADM-005: hooks are added next to existing ones and removed without touching them", () => {
    const file = path.join(tmp, "hooks.json");
    const existing = {
      model: "x",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool" }] }] },
    };
    fs.writeFileSync(file, JSON.stringify(existing));
    addHooks(file, ["Stop", "SessionStart"], `${MARKER} node x hook codex || :`);
    addHooks(file, ["Stop", "SessionStart"], `${MARKER} node y hook codex || :`); // again: replaces ours
    const added = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(added.model).toBe("x");
    expect(added.hooks.Stop).toHaveLength(2);
    expect(added.hooks.Stop[0].hooks[0].command).toBe("other-tool");
    expect(added.hooks.Stop[1].hooks[0].command).toContain("node y");
    expect(added.hooks.SessionStart).toHaveLength(1);

    expect(removeHooks(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(existing);
    expect(removeHooks(file)).toBe(false);
  });

  test("REQ-ADM-005: a file that only held our hooks is deleted on removal", () => {
    const file = path.join(tmp, ".claude", "settings.local.json");
    addHooks(file, ["Stop"], `${MARKER} node x hook claude-code || :`);
    removeHooks(file);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("connect", () => {
  function fakeServer(opts: { status?: number } = {}) {
    const calls: string[] = [];
    let revoked = false;
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      const u = new URL(String(url));
      calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.pathname === "/api/device-tokens") {
        const body = JSON.parse(String(init?.body));
        if (opts.status) return new Response("{}", { status: opts.status });
        if (body.password !== "secret-pw") return new Response("{}", { status: 401 });
        return Response.json({ id: 1, token: "dev-token" });
      }
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== "Bearer dev-token" || revoked) return new Response("{}", { status: 401 });
      if (u.pathname === "/api/me") return Response.json({ me: { name: "나개발" } });
      if (u.pathname === "/api/device-tokens/self") {
        revoked = true;
        return Response.json({ ok: true });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  const base = (fetchImpl: typeof fetch, extra: object = {}) => ({
    home,
    server: "http://devtools.test:4100/some/path",
    dir: path.join(repo),
    tools: ["claude-code", "codex"] as const satisfies readonly ("claude-code" | "codex")[],
    ask: async (q: string) => (q.includes("ID") ? "me" : "secret-pw"),
    log: () => {},
    node: "/usr/bin/node",
    script: path.join(home, "bin", "devtools.mjs"),
    fetchImpl,
    env: { CODEX_HOME: path.join(tmp, "codex") },
    ...extra,
  });

  test("REQ-ADM-001, REQ-ADM-012: connect stores only the token and installs hooks for each tool", async () => {
    const { fetchImpl } = fakeServer();
    await connect({ ...base(fetchImpl), tools: ["claude-code", "codex"] });
    const cfg = loadConfig(home)!;
    expect(cfg).toMatchObject({ server: "http://devtools.test:4100", token: "dev-token", loginId: "me" });
    expect(cfg.projects).toEqual([{ root: fs.realpathSync(repo), tools: ["claude-code", "codex"] }]);
    const saved = fs.readFileSync(path.join(home, "config.json"), "utf8");
    expect(saved).not.toContain("secret-pw");
    expect(fs.statSync(path.join(home, "config.json")).mode & 0o777).toBe(0o600);

    const claudeFile = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8"));
    expect(claudeFile.hooks.PostToolUse[0].hooks[0].command).toContain("hook claude-code");
    const codexFile = JSON.parse(fs.readFileSync(path.join(tmp, "codex", "hooks.json"), "utf8"));
    expect(Object.keys(codexFile.hooks)).toContain("SessionEnd");
    // The personal settings file must not be committed by accident.
    expect(sh(repo, "status", "--porcelain")).toBe("");
  });

  test("REQ-ADM-012: wrong passwords and temporary passwords are explained", async () => {
    await expect(connect({ ...base(fakeServer().fetchImpl), tools: ["claude-code"], password: "nope" })).rejects.toThrow("ID나 비밀번호");
    await expect(connect({ ...base(fakeServer({ status: 403 }).fetchImpl), tools: ["claude-code"] })).rejects.toThrow("임시 비밀번호");
    expect(loadConfig(home)).toBeNull();
  });

  test("REQ-ADM-005: disconnect removes the hooks and revokes the token when nothing stays connected", async () => {
    const { fetchImpl, calls } = fakeServer();
    await connect({ ...base(fetchImpl), tools: ["claude-code", "codex"] });
    await disconnect({ home, dir: repo, all: false, log: () => {}, fetchImpl, env: { CODEX_HOME: path.join(tmp, "codex") } });
    expect(fs.existsSync(path.join(repo, ".claude", "settings.local.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "codex", "hooks.json"))).toBe(false);
    expect(calls).toContain("DELETE /api/device-tokens/self");
    expect(loadConfig(home)).toBeNull();
    expect(fs.existsSync(home)).toBe(false);
  });
});

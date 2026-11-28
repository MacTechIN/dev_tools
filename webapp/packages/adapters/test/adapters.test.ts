import { readFileSync } from "node:fs";
import path from "node:path";
import { eventSchema } from "@devtools/shared";
import { describe, expect, test } from "vitest";
import { classifyCommand, claudeCode, codex, patchPaths, relPath, type Adapter, type ConvertContext } from "../src";

const ROOT = "/work/demo";
const fixtures = (rel: string) =>
  readFileSync(path.join(import.meta.dirname, "..", rel), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

function ctx(): ConvertContext {
  let n = 0;
  return { root: ROOT, now: () => "2026-11-27T00:00:00.000Z", newId: () => `n${++n}` };
}

function convertAll(adapter: Adapter, payloads: unknown[]) {
  const c = ctx();
  return payloads.flatMap((p) => adapter.convert(p, c)?.events ?? []);
}

describe("claude-code adapter", () => {
  const payloads = fixtures("claude-code/fixtures/2.1.332.jsonl");

  test("REQ-COL-002, REQ-COL-004: real Claude Code hook payloads become common events", () => {
    const events = convertAll(claudeCode, payloads);
    expect(events.map((e) => e.kind)).toEqual([
      "session.start",
      "turn.start",
      "file.change",
      "command.run",
      "command.run",
      "turn.end",
      "session.end",
    ]);
    expect(events[2]).toMatchObject({ data: { paths: ["hello.txt"] }, cwd: "." });
    expect(events[3]).toMatchObject({ data: { category: "other", ok: true } });
    expect(events[4]).toMatchObject({ data: { category: "other", ok: false } });
    expect(events[6]).toMatchObject({ data: { reason: "other" } });
    for (const e of events) expect(eventSchema.safeParse({ ...e, branch: "main" }).success).toBe(true);
  });

  test("REQ-COL-006: prompt text, file content, command text and replies are not in the events", () => {
    const out = JSON.stringify(convertAll(claudeCode, payloads));
    for (const secret of ["Create a file", "hi\\n", "Done.", "List files", '"ls"', "transcript"]) {
      expect(out).not.toContain(secret);
    }
  });

  test("REQ-COL-002: the same tool use always gets the same event id, so a resend is stored once", () => {
    const post = payloads.find((p) => p.hook_event_name === "PostToolUse")!;
    const a = claudeCode.convert(post, ctx())!.events[0]!;
    const b = claudeCode.convert(post, ctx())!.events[0]!;
    expect(a.id).toBe(b.id);
  });

  test("REQ-COL-002: files outside the project and unknown payloads are ignored", () => {
    const outside = { ...payloads[3], tool_input: { file_path: "/etc/passwd", content: "x" } };
    expect(claudeCode.convert(outside, ctx())!.events).toEqual([]);
    expect(claudeCode.convert({ hook_event_name: "Stop" }, ctx())).toBeNull();
    expect(claudeCode.convert("garbage", ctx())).toBeNull();
    expect(claudeCode.convert({ session_id: "s", hook_event_name: "PreCompact" }, ctx())).toBeNull();
  });
});

describe("codex adapter", () => {
  const payloads = fixtures("codex/fixtures/0.166.0.jsonl");
  const common = { session_id: "s1", cwd: ROOT, transcript_path: null, model: "m", permission_mode: "default", turn_id: "t1" };

  test("REQ-COL-003, REQ-COL-004: real Codex session payloads become common events", () => {
    const c = ctx();
    const results = payloads.map((p) => codex.convert(p, c));
    expect(results.flatMap((r) => r?.events ?? []).map((e) => e.kind)).toEqual(["session.start", "turn.start", "session.end"]);
    expect(results[1]?.scan).toBe("begin");
    expect(JSON.stringify(results)).not.toContain("Create a file");
  });

  test("REQ-COL-003: turn end asks for a git scan of changed files", () => {
    const r = codex.convert({ ...common, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "secret reply" }, ctx());
    expect(r?.scan).toBe("end");
    expect(r?.events.map((e) => e.kind)).toEqual(["turn.end"]);
    expect(JSON.stringify(r)).not.toContain("secret reply");
  });

  test("REQ-COL-003: apply_patch and shell tool uses become file changes and commands", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: /work/demo/src/b.ts\n+z\n*** End Patch";
    const [file] = codex.convert(
      { ...common, hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_use_id: "u1", tool_input: { input: patch }, tool_response: {} },
      ctx(),
    )!.events;
    expect(file).toMatchObject({ kind: "file.change", id: "codex:s1:u1", data: { paths: ["src/a.ts", "src/b.ts"] } });
    expect(JSON.stringify(file)).not.toContain("+y");

    const [cmd] = codex.convert(
      { ...common, hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "u2", tool_input: { command: ["npx", "vitest", "run"] }, tool_response: { exit_code: 1 } },
      ctx(),
    )!.events;
    expect(cmd).toMatchObject({ kind: "command.run", data: { category: "test", ok: false } });

    const generic = codex.convert(
      { ...common, hook_event_name: "PostToolUse", tool_name: "exec", tool_use_id: "u3", tool_input: "await tools.run()", tool_response: {} },
      ctx(),
    );
    expect(generic?.events).toEqual([]);
  });
});

describe("helpers", () => {
  test("REQ-COL-006: commands are reduced to a category", () => {
    expect(classifyCommand("npm test")).toBe("test");
    expect(classifyCommand("cd webapp && npm run test -w x")).toBe("test");
    expect(classifyCommand("pytest -q tests/")).toBe("test");
    expect(classifyCommand("npm run build")).toBe("build");
    expect(classifyCommand(["cargo", "build", "--release"])).toBe("build");
    expect(classifyCommand("ls -la")).toBe("other");
    expect(classifyCommand("cat makefile")).toBe("other");
  });

  test("REQ-COL-004: paths are made relative to the project root", () => {
    expect(relPath(ROOT, "/work/demo/src/x.ts")).toBe("src/x.ts");
    expect(relPath(ROOT, "src/x.ts")).toBe("src/x.ts");
    expect(relPath(ROOT, "/work/demo")).toBe(".");
    expect(relPath(ROOT, "/work/other/x")).toBeNull();
    expect(relPath(ROOT, "../x")).toBeNull();
    expect(patchPaths("*** Delete File: a\n*** Update File: b\n*** Move to: c\n")).toEqual(["a", "b", "c"]);
  });
});

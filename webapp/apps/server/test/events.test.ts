import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Snapshot } from "@devtools/shared";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ADMIN, addMember, deviceToken, event, login, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let token: string;
beforeEach(async () => {
  t = await startApp();
  admin = await login(t.app, ADMIN.loginId, ADMIN.password);
  token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password);
});
afterEach(() => t.close());

const send = (events: unknown[], bearer = token) =>
  t.app.inject({ method: "POST", url: "/api/events", headers: { authorization: `Bearer ${bearer}` }, payload: { events } });
const snapshot = async (cookie = admin) =>
  (await t.app.inject({ method: "GET", url: "/api/snapshot", headers: { cookie } })).json() as Snapshot;

test("REQ-COL-001: events are stored in arrival order and a repeated id is stored once", async () => {
  const first = await send([event("a", "session.start"), event("b", "turn.start")]);
  expect(first.json()).toEqual({ stored: 2, duplicates: 0, rejected: 0 });
  const again = await send([event("b", "turn.start"), event("c", "turn.end")]);
  expect(again.json()).toEqual({ stored: 1, duplicates: 1, rejected: 0 });
  const rows = t.store.db.prepare("SELECT id FROM events ORDER BY seq").all() as { id: string }[];
  expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
});

test("REQ-COL-004: events not in the common format are rejected without failing the batch", async () => {
  const res = await send([event("a", "session.start"), { id: "x", kind: "made.up" }, event("b", "file.change", { data: { paths: ["a.ts"] } })]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ stored: 2, duplicates: 0, rejected: 1 });
});

test("REQ-COL-006: prompt and code bodies never reach the database", async () => {
  await send([event("a", "turn.start", { prompt: "TOP-SECRET-PROMPT", data: { text: "TOP-SECRET-PROMPT" } })]);
  await send([event("b", "file.change", { data: { paths: ["a.ts"], content: "TOP-SECRET-CODE" } })]);
  const dump = JSON.stringify(t.store.db.prepare("SELECT * FROM events").all());
  expect(dump).not.toContain("TOP-SECRET");
});

test("REQ-COL-001: the member comes from the token, not from the request body", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  await send([event("a", "session.start", { member: minji.id, memberId: minji.id })]);
  const row = t.store.db.prepare("SELECT member_id FROM events").get() as { member_id: number };
  expect(row.member_id).not.toBe(minji.id);
});

test("REQ-DSH-002: the home row shows the tool, branch and last activity of each member", async () => {
  await send([
    event("a", "session.start", { branch: "req/REQ-TSK-003-atomic-claim" }),
    event("b", "file.change", { data: { paths: ["server/claims.ts", "server/jobs/expire.ts"] } }),
    event("c", "file.change", { data: { paths: ["server/claims.ts"] } }),
  ]);
  const me = (await snapshot()).members.find((m) => m.loginId === "admin")!;
  expect(me.tools).toEqual(["claude-code"]);
  expect(me.current).toMatchObject({
    tool: "claude-code",
    branch: "req/REQ-TSK-003-atomic-claim",
    open: true,
    lastKind: "file.change",
    filesChanged: 2,
  });
});

test("REQ-DSH-002: ending the session closes the member's current work", async () => {
  await send([event("a", "session.start"), event("b", "session.end")]);
  expect((await snapshot()).members[0]!.current!.open).toBe(false);
});

test("REQ-DSH-006: the feed lists big moments only, newest first", async () => {
  await send([
    event("a", "session.start"),
    event("b", "file.change", { data: { paths: ["a.ts"] } }),
    event("c", "test.result", { data: { passed: 2, failed: 1 } }),
    event("d", "git.commit", { tool: "git", data: { hash: "abc123", subject: "Add expiry job (REQ-TSK-005)" } }),
  ]);
  const feed = (await snapshot()).feed;
  expect(feed.map((f) => f.kind)).toEqual(["git.commit", "test.result", "session.start"]);
  expect(feed[1]!.data).toEqual({ passed: 2, failed: 1 });
});

test("REQ-NFR-005: a client that reconnects receives only the changes it missed", async () => {
  await send([event("a", "session.start")]);
  const seq = (await snapshot()).seq;
  expect(t.store.changesSince(seq)).toEqual([]);
  await send([event("b", "test.result", { data: { passed: 1, failed: 0 } })]);
  const missed = t.store.changesSince(seq)!;
  expect(missed.map((c) => c.change.type)).toEqual(["feed", "member"]);
  expect(missed.every((c) => c.seq > seq)).toBe(true);
});

test("REQ-DSH-003: a live stream delivers a change as it happens", async () => {
  const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
  const controller = new AbortController();
  const res = await fetch(`${address}/api/stream?since=${t.store.lastChangeSeq()}`, { headers: { cookie: admin }, signal: controller.signal });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  await send([event("a", "session.start")]);
  let text = "";
  while (!text.includes("event: member")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  controller.abort();
  expect(text).toContain("event: feed");
  expect(text).toMatch(/id: \d+/);
});

test("REQ-NFR-004: records survive a server restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devtools-"));
  const file = path.join(dir, "test.sqlite");
  const first = await startApp(file);
  const firstToken = await deviceToken(first.app, ADMIN.loginId, ADMIN.password);
  await first.app.inject({ method: "POST", url: "/api/events", headers: { authorization: `Bearer ${firstToken}` }, payload: { events: [event("a", "session.start")] } });
  await first.close();

  const second = await startApp(file);
  expect(second.store.eventCount()).toBe(1);
  const again = await second.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${firstToken}` } });
  expect(again.statusCode).toBe(200);
  await second.close();
  fs.rmSync(dir, { recursive: true });
});

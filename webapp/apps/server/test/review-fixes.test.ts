// Regression tests for defects found in the first code review (2026-11-26).
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadConfig } from "../src/config";
import { ADMIN, addMember, deviceToken, event, login, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
beforeEach(async () => {
  t = await startApp();
  admin = await login(t.app, ADMIN.loginId, ADMIN.password);
});
afterEach(() => t.close());

const loginReq = (password: string) =>
  t.app.inject({ method: "POST", url: "/api/login", payload: { loginId: ADMIN.loginId, password } });

/** Reads an SSE response until it ends or the timeout passes. */
async function readStream(res: Response, ms: number): Promise<{ text: string; ended: boolean }> {
  const reader = res.body!.getReader();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))]);
    if (chunk === null) break;
    if (chunk.done) return { text, ended: true };
    text += new TextDecoder().decode(chunk.value);
  }
  await reader.cancel().catch(() => undefined);
  return { text, ended: false };
}

test("REQ-NFR-009: parallel wrong guesses cannot get past the lockout", async () => {
  const results = await Promise.all(Array.from({ length: 30 }, () => loginReq("wrong")));
  const evaluated = results.filter((r) => r.statusCode === 401).length;
  expect(evaluated).toBeLessThanOrEqual(5);
  expect((await loginReq(ADMIN.password)).statusCode).toBe(429);
});

test("REQ-NFR-009: the lockout also covers device-token issue", async () => {
  for (let i = 0; i < 5; i++) await loginReq("wrong");
  const res = await t.app.inject({ method: "POST", url: "/api/device-tokens", payload: { ...ADMIN, label: "x" } });
  expect(res.statusCode).toBe(429);
});

test("REQ-ADM-008: a stream replaying an old resting change does not crash the server", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { active: false } });
  await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { active: true } });
  const cookie = await login(t.app, minji.loginId, minji.password);
  const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
  const res = await fetch(`${address}/api/stream?since=0`, { headers: { cookie } });
  const { text, ended } = await readStream(res, 500);
  expect(ended).toBe(false);
  expect(text.match(/event: member/g)!.length).toBeGreaterThanOrEqual(2);
  expect((await fetch(`${address}/api/health`)).status).toBe(200);
});

test("REQ-ADM-008: setting a member to resting closes their open stream", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
  const res = await fetch(`${address}/api/stream`, { headers: { cookie: minji.cookie } });
  const reading = readStream(res, 3000);
  await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { active: false } });
  expect((await reading).ended).toBe(true);
});

test("REQ-ADM-011: a password reset closes the member's open stream", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
  const res = await fetch(`${address}/api/stream`, { headers: { cookie: minji.cookie } });
  const reading = readStream(res, 3000);
  await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { resetPassword: true } });
  expect((await reading).ended).toBe(true);
});

test("REQ-ADM-002: logging out closes that session's stream", async () => {
  const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
  const res = await fetch(`${address}/api/stream`, { headers: { cookie: admin } });
  const reading = readStream(res, 3000);
  await t.app.inject({ method: "POST", url: "/api/logout", headers: { cookie: admin } });
  expect((await reading).ended).toBe(true);
});

test("REQ-ADM-012: a temporary password cannot be used to connect a computer", async () => {
  const created = await t.app.inject({ method: "POST", url: "/api/members", headers: { cookie: admin }, payload: { loginId: "minji", name: "민지", roles: ["dev"] } });
  const res = await t.app.inject({ method: "POST", url: "/api/device-tokens", payload: { loginId: "minji", password: created.json().tempPassword, label: "x" } });
  expect(res.statusCode).toBe(403);
  expect(res.json().error).toBe("password_change_required");
});

test("REQ-ADM-011: changing the password signs out other sessions and devices but keeps this one", async () => {
  const other = await login(t.app, ADMIN.loginId, ADMIN.password);
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password);
  const res = await t.app.inject({ method: "PUT", url: "/api/me/password", headers: { cookie: admin }, payload: { current: ADMIN.password, next: "another-password" } });
  expect(res.statusCode).toBe(200);
  expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: admin } })).statusCode).toBe(200);
  expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: other } })).statusCode).toBe(401);
  expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
});

test("REQ-ADM-011: the new password must differ from the current one", async () => {
  const res = await t.app.inject({ method: "PUT", url: "/api/me/password", headers: { cookie: admin }, payload: { current: ADMIN.password, next: ADMIN.password } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe("same_password");
});

test("REQ-ADM-010: concurrent demotions cannot remove every admin", async () => {
  const second = await addMember(t.app, admin, "second", "둘째");
  await t.app.inject({ method: "PATCH", url: `/api/members/${second.id}`, headers: { cookie: admin }, payload: { roles: ["admin", "dev"] } });
  const me = (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: admin } })).json().me;
  await Promise.all(
    [me.id, second.id].map((id) =>
      t.app.inject({ method: "PATCH", url: `/api/members/${id}`, headers: { cookie: admin }, payload: { roles: ["dev"], resetPassword: true } }),
    ),
  );
  expect(t.store.activeAdminCount()).toBe(1);
});

test("REQ-ADM-007: concurrent adds with the same id give one member and a 409", async () => {
  const add = () => t.app.inject({ method: "POST", url: "/api/members", headers: { cookie: admin }, payload: { loginId: "same", name: "같음", roles: ["dev"] } });
  const codes = (await Promise.all([add(), add()])).map((r) => r.statusCode).sort();
  expect(codes).toEqual([201, 409]);
});

test("REQ-ADM-007: a blank name is rejected", async () => {
  const res = await t.app.inject({ method: "POST", url: "/api/members", headers: { cookie: admin }, payload: { loginId: "blank", name: "   ", roles: ["dev"] } });
  expect(res.statusCode).toBe(400);
});

test("REQ-DSH-002: a late session.end does not close a session that went on", async () => {
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password);
  const at = (s: number) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
  const post = (events: unknown[]) =>
    t.app.inject({ method: "POST", url: "/api/events", headers: { authorization: `Bearer ${token}` }, payload: { events } });
  await post([event("a", "session.start", { at: at(0) }), event("c", "turn.start", { at: at(10) })]);
  await post([event("b", "session.end", { at: at(5) })]);
  const snap = (await t.app.inject({ method: "GET", url: "/api/snapshot", headers: { cookie: admin } })).json();
  expect(snap.members[0].current.open).toBe(true);
});

test("REQ-DSH-008: an event time far in the future is clamped", async () => {
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password);
  await t.app.inject({ method: "POST", url: "/api/events", headers: { authorization: `Bearer ${token}` }, payload: { events: [event("a", "session.start", { at: "2099-01-01T00:00:00Z" })] } });
  const snap = (await t.app.inject({ method: "GET", url: "/api/snapshot", headers: { cookie: admin } })).json();
  expect(Date.parse(snap.members[0].current.lastEventAt)).toBeLessThan(Date.now() + 10 * 60_000);
});

test("REQ-COL-004: a kind with required data is rejected when data is missing", async () => {
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password);
  const res = await t.app.inject({ method: "POST", url: "/api/events", headers: { authorization: `Bearer ${token}` }, payload: { events: [{ ...event("a", "test.result"), data: undefined }] } });
  expect(res.json()).toMatchObject({ stored: 0, rejected: 1 });
});

test("REQ-NFR-005: a client ahead of the server is told to reload", async () => {
  expect(t.store.changesSince(t.store.lastChangeSeq() + 100)).toBeNull();
});

test("REQ-NFR-003: HEAD on the health check works without a login", async () => {
  expect((await t.app.inject({ method: "HEAD", url: "/api/health" })).statusCode).toBe(200);
});

test("REQ-ADM-003: an empty ADMIN_NAME falls back to the admin id", () => {
  expect(loadConfig({ ADMIN_ID: "boss", ADMIN_NAME: "", ADMIN_PASSWORD: "long-enough" }).admin?.name).toBe("boss");
});

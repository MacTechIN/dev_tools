import { afterEach, beforeEach, expect, test } from "vitest";
import { ADMIN, addMember, deviceToken, login, startApp, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await startApp();
});
afterEach(() => t.close());

test("REQ-ADM-002: a member logs in with id and password", async () => {
  const cookie = await login(t.app, ADMIN.loginId, ADMIN.password);
  const res = await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
  expect(res.statusCode).toBe(200);
  expect(res.json().me).toMatchObject({ loginId: "admin", roles: ["admin", "lead", "dev"] });
});

test("REQ-ADM-002: a wrong password and an unknown id get the same answer", async () => {
  const wrong = await t.app.inject({ method: "POST", url: "/api/login", payload: { loginId: "admin", password: "nope" } });
  const unknown = await t.app.inject({ method: "POST", url: "/api/login", payload: { loginId: "ghost", password: "nope" } });
  expect(wrong.statusCode).toBe(401);
  expect(unknown.statusCode).toBe(401);
  expect(wrong.body).toBe(unknown.body);
});

test("REQ-NFR-009: passwords are stored only as a hash", async () => {
  const row = t.store.memberByLoginId("admin")!;
  expect(row.password_hash).not.toContain(ADMIN.password);
  expect(row.password_hash).toMatch(/^\$argon2id\$/);
});

test("REQ-NFR-009: repeated failures lock the login for a while", async () => {
  for (let i = 0; i < 5; i++) {
    await t.app.inject({ method: "POST", url: "/api/login", payload: { loginId: "admin", password: "nope" } });
  }
  const res = await t.app.inject({ method: "POST", url: "/api/login", payload: ADMIN });
  expect(res.statusCode).toBe(429);
});

test("REQ-NFR-003: no API works without a login except login itself", async () => {
  for (const [method, url] of [
    ["GET", "/api/me"],
    ["GET", "/api/snapshot"],
    ["GET", "/api/members"],
    ["POST", "/api/members"],
    ["POST", "/api/events"],
    ["GET", "/api/stream"],
    ["GET", "/api/me/device-tokens"],
  ] as const) {
    const res = await t.app.inject({ method, url, payload: method === "POST" ? {} : undefined });
    expect(res.statusCode, `${method} ${url}`).toBe(401);
  }
  expect((await t.app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
});

test("REQ-ADM-002: logout ends the session", async () => {
  const cookie = await login(t.app, ADMIN.loginId, ADMIN.password);
  await t.app.inject({ method: "POST", url: "/api/logout", headers: { cookie } });
  expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
});

test("REQ-ADM-011: a member changes their own password", async () => {
  const cookie = await login(t.app, ADMIN.loginId, ADMIN.password);
  const short = await t.app.inject({ method: "PUT", url: "/api/me/password", headers: { cookie }, payload: { current: ADMIN.password, next: "short" } });
  expect(short.statusCode).toBe(400);
  const ok = await t.app.inject({ method: "PUT", url: "/api/me/password", headers: { cookie }, payload: { current: ADMIN.password, next: "a-new-password" } });
  expect(ok.statusCode).toBe(200);
  await expect(login(t.app, ADMIN.loginId, ADMIN.password)).rejects.toThrow();
  await login(t.app, ADMIN.loginId, "a-new-password");
});

test("REQ-ADM-011: a temporary password must be changed before anything else", async () => {
  const admin = await login(t.app, ADMIN.loginId, ADMIN.password);
  const created = await t.app.inject({ method: "POST", url: "/api/members", headers: { cookie: admin }, payload: { loginId: "minji", name: "민지", roles: ["dev"] } });
  const cookie = await login(t.app, "minji", created.json().tempPassword);
  const blocked = await t.app.inject({ method: "GET", url: "/api/snapshot", headers: { cookie } });
  expect(blocked.statusCode).toBe(403);
  expect(blocked.json().error).toBe("password_change_required");
});

test("REQ-ADM-012: the connect login returns a device token and the token works for sending events", async () => {
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password, "laptop");
  const me = await t.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
  expect(me.statusCode).toBe(200);
  // The raw token is never stored.
  const stored = t.store.db.prepare("SELECT token_hash FROM device_tokens").get() as { token_hash: string };
  expect(stored.token_hash).not.toBe(token);
});

test("REQ-ADM-012: a device token cannot use member or admin APIs", async () => {
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password);
  const res = await t.app.inject({ method: "GET", url: "/api/members", headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode).toBe(403);
});

test("REQ-ADM-013: a member lists and disconnects their device tokens", async () => {
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password, "laptop");
  const cookie = await login(t.app, ADMIN.loginId, ADMIN.password);
  const list = await t.app.inject({ method: "GET", url: "/api/me/device-tokens", headers: { cookie } });
  const [first] = list.json().tokens;
  expect(first.label).toBe("laptop");
  await t.app.inject({ method: "DELETE", url: `/api/me/device-tokens/${first.id}`, headers: { cookie } });
  const after = await t.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
  expect(after.statusCode).toBe(401);
});

test("REQ-ADM-013: a member cannot disconnect someone else's token", async () => {
  const admin = await login(t.app, ADMIN.loginId, ADMIN.password);
  const minji = await addMember(t.app, admin, "minji", "민지");
  await deviceToken(t.app, ADMIN.loginId, ADMIN.password);
  const adminTokens = await t.app.inject({ method: "GET", url: "/api/me/device-tokens", headers: { cookie: admin } });
  const id = adminTokens.json().tokens[0].id;
  const res = await t.app.inject({ method: "DELETE", url: `/api/me/device-tokens/${id}`, headers: { cookie: minji.cookie } });
  expect(res.statusCode).toBe(404);
});

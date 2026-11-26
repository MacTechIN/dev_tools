import { afterEach, beforeEach, expect, test } from "vitest";
import { ADMIN, addMember, deviceToken, login, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
beforeEach(async () => {
  t = await startApp();
  admin = await login(t.app, ADMIN.loginId, ADMIN.password);
});
afterEach(() => t.close());

test("REQ-ADM-007: an admin adds members at any time with no upper limit", async () => {
  for (let i = 0; i < 12; i++) {
    const res = await t.app.inject({ method: "POST", url: "/api/members", headers: { cookie: admin }, payload: { loginId: `dev${i}`, name: `개발자 ${i}`, roles: ["dev"] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().tempPassword.length).toBeGreaterThanOrEqual(8);
  }
  const list = await t.app.inject({ method: "GET", url: "/api/members", headers: { cookie: admin } });
  expect(list.json().members).toHaveLength(13);
});

test("REQ-ADM-007: only an admin can add members and ids are unique", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  const byDev = await t.app.inject({ method: "POST", url: "/api/members", headers: { cookie: minji.cookie }, payload: { loginId: "x1", name: "x", roles: ["dev"] } });
  expect(byDev.statusCode).toBe(403);
  const duplicate = await t.app.inject({ method: "POST", url: "/api/members", headers: { cookie: admin }, payload: { loginId: "MINJI", name: "x", roles: ["dev"] } });
  expect(duplicate.statusCode).toBe(409);
});

test("REQ-ADM-008: a resting member cannot log in or send events, and their record stays", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  const token = await deviceToken(t.app, minji.loginId, minji.password);
  const res = await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { active: false } });
  expect(res.json().member.active).toBe(false);

  expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: minji.cookie } })).statusCode).toBe(401);
  expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  await expect(login(t.app, minji.loginId, minji.password)).rejects.toThrow();

  const list = await t.app.inject({ method: "GET", url: "/api/members", headers: { cookie: admin } });
  expect(list.json().members.map((m: { loginId: string }) => m.loginId)).toContain("minji");
});

test("REQ-ADM-008: a resting member can be brought back", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { active: false } });
  await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { active: true } });
  await login(t.app, minji.loginId, minji.password);
});

test("REQ-ADM-010: a member can hold several roles", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  const res = await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { roles: ["dev", "lead"] } });
  expect(res.json().member.roles).toEqual(["lead", "dev"]);
});

test("REQ-ADM-010: the last admin cannot be removed or set to resting", async () => {
  const me = (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: admin } })).json().me;
  const demote = await t.app.inject({ method: "PATCH", url: `/api/members/${me.id}`, headers: { cookie: admin }, payload: { roles: ["dev"] } });
  const rest = await t.app.inject({ method: "PATCH", url: `/api/members/${me.id}`, headers: { cookie: admin }, payload: { active: false } });
  expect(demote.statusCode).toBe(409);
  expect(rest.statusCode).toBe(409);
});

test("REQ-ADM-011: an admin reissues a temporary password, which signs the member out", async () => {
  const minji = await addMember(t.app, admin, "minji", "민지");
  const res = await t.app.inject({ method: "PATCH", url: `/api/members/${minji.id}`, headers: { cookie: admin }, payload: { resetPassword: true } });
  const { tempPassword } = res.json();
  expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: minji.cookie } })).statusCode).toBe(401);
  await expect(login(t.app, minji.loginId, minji.password)).rejects.toThrow();
  await login(t.app, minji.loginId, tempPassword);
});

test("REQ-CHT-007: a status note shows on the member's row", async () => {
  await t.app.inject({ method: "PUT", url: "/api/me/status", headers: { cookie: admin }, payload: { note: "3시까지 회의예요" } });
  const snap = await t.app.inject({ method: "GET", url: "/api/snapshot", headers: { cookie: admin } });
  expect(snap.json().members[0].statusNote).toBe("3시까지 회의예요");
});

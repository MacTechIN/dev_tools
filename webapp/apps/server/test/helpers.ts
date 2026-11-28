import type { FastifyInstance } from "fastify";
import { buildApp, ensureAdmin } from "../src/app";
import type { Config } from "../src/config";
import { openDb } from "../src/db";
import type { Store } from "../src/store";

export const ADMIN = { loginId: "admin", name: "관리자", password: "admin-password" };

export function testConfig(dbPath = ":memory:", cliBundle = "/nonexistent/devtools.mjs"): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    dbPath,
    cookieSecure: false,
    webDist: "/nonexistent",
    cliBundle,
    sessionDays: 30,
    admin: ADMIN,
  };
}

export interface TestApp {
  app: FastifyInstance;
  store: Store;
  close(): Promise<void>;
}

export async function startApp(dbPath = ":memory:", cliBundle?: string): Promise<TestApp> {
  const config = testConfig(dbPath, cliBundle);
  const db = openDb(config.dbPath);
  const { app, store } = await buildApp({ db, config, memberChangeDelayMs: 0 });
  await ensureAdmin(store, config);
  return {
    app,
    store,
    async close() {
      await app.close();
      db.close();
    },
  };
}

/** Logs in and returns the cookie header value. */
export async function login(app: FastifyInstance, loginId: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { loginId, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const sid = res.cookies.find((c) => c.name === "sid")!;
  return `sid=${sid.value}`;
}

export async function deviceToken(app: FastifyInstance, loginId: string, password: string, label = "test"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/device-tokens", payload: { loginId, password, label } });
  if (res.statusCode !== 200) throw new Error(`token failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { token: string }).token;
}

/** Adds a member as admin and sets a real password, returning their credentials. */
export async function addMember(app: FastifyInstance, adminCookie: string, loginId: string, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/members",
    headers: { cookie: adminCookie },
    payload: { loginId, name, roles: ["dev"] },
  });
  const { member, tempPassword } = res.json() as { member: { id: number }; tempPassword: string };
  const cookie = await login(app, loginId, tempPassword);
  const password = `${loginId}-password`;
  await app.inject({ method: "PUT", url: "/api/me/password", headers: { cookie }, payload: { current: tempPassword, next: password } });
  return { id: member.id, loginId, password, cookie, tempPassword };
}

export function event(id: string, kind: string, extra: Record<string, unknown> = {}) {
  return { id, tool: "claude-code", session: "s1", at: new Date().toISOString(), kind, ...extra };
}

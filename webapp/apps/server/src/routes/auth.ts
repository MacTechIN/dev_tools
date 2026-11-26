import type { Me } from "@devtools/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { COOKIE_NAME, fail, type AppContext } from "../app";
import { hashPassword, MIN_PASSWORD_LENGTH, randomToken, sha256, verifyPassword } from "../security";
import { parseRoles, type MemberRow } from "../store";

const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

const credentials = z.object({ loginId: z.string().min(1).max(100), password: z.string().min(1).max(200) });

export function toMe(m: MemberRow): Me {
  return { id: m.id, loginId: m.login_id, name: m.name, roles: parseRoles(m.roles), mustChangePassword: m.must_change_password === 1 };
}

interface Attempts {
  failures: number;
  /** Checks still running. Counted up front so parallel guesses cannot all slip past the limit. */
  pending: number;
  lockedUntil: number;
}

/** Limits password guesses per login id (REQ-NFR-009). */
export class PasswordGuard {
  private readonly attempts = new Map<string, Attempts>();
  // Verified against when the login id is unknown, so both cases take similar time.
  private readonly dummyHash = hashPassword(randomToken());

  constructor(private readonly lookup: (loginId: string) => MemberRow | undefined) {}

  /** Returns the member, or the HTTP status to answer with. */
  async check(loginId: string, password: string): Promise<MemberRow | 401 | 429> {
    const key = loginId.toLowerCase();
    const now = Date.now();
    let a = this.attempts.get(key);
    if (a && a.lockedUntil > now) return 429;
    if (!a || a.lockedUntil !== 0) {
      a = { failures: 0, pending: 0, lockedUntil: 0 };
      this.attempts.set(key, a);
    }
    if (a.failures + a.pending >= MAX_FAILURES) return 429;
    a.pending++;
    let ok = false;
    const member = this.lookup(loginId);
    try {
      ok = await verifyPassword(member?.password_hash ?? (await this.dummyHash), password);
    } finally {
      a.pending--;
    }
    if (member && member.active === 1 && ok) {
      if (a.pending === 0) this.attempts.delete(key);
      else a.failures = 0;
      return member;
    }
    a.failures++;
    if (a.failures >= MAX_FAILURES) a.lockedUntil = Date.now() + LOCK_MS;
    return 401;
  }
}

export function authRoutes(app: FastifyInstance, { store, config }: AppContext) {
  const guard = new PasswordGuard((loginId) => store.memberByLoginId(loginId));

  app.post("/api/login", async (req, reply) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) return fail(reply, 400, "invalid_request");
    const result = await guard.check(body.data.loginId, body.data.password);
    if (result === 429) return fail(reply, 429, "too_many_attempts");
    if (result === 401) return fail(reply, 401, "invalid_credentials");
    const sid = randomToken();
    store.createWebSession(sha256(sid), result.id, config.sessionDays);
    reply.setCookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      path: "/",
      maxAge: config.sessionDays * 86_400,
    });
    return { me: toMe(result) };
  });

  app.post("/api/logout", async (req, reply) => {
    const sid = req.cookies[COOKIE_NAME];
    if (sid) store.deleteWebSession(sha256(sid));
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req) => ({ me: toMe(req.member) }));

  // Changing the password signs out every other session and device, so a leaked
  // temporary password stops working everywhere once it is replaced (REQ-ADM-011).
  app.put("/api/me/password", async (req, reply) => {
    const body = z
      .object({ current: z.string().min(1).max(200), next: z.string().min(MIN_PASSWORD_LENGTH).max(200) })
      .safeParse(req.body);
    if (!body.success) return fail(reply, 400, "weak_password");
    if (body.data.next === body.data.current) return fail(reply, 400, "same_password");
    const result = await guard.check(req.member.login_id, body.data.current);
    if (result === 429) return fail(reply, 429, "too_many_attempts");
    if (result === 401) return fail(reply, 401, "invalid_credentials");
    store.updateMember(req.member.id, { passwordHash: await hashPassword(body.data.next), mustChangePassword: false });
    store.revokeAccess(req.member.id, sha256(req.cookies[COOKIE_NAME] ?? ""));
    return { ok: true };
  });

  app.put("/api/me/status", async (req, reply) => {
    const body = z.object({ note: z.string().max(80) }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "invalid_request");
    store.updateMember(req.member.id, { statusNote: body.data.note.trim() });
    store.addChange({ type: "member", payload: store.memberView(req.member.id) });
    return { ok: true };
  });

  // Used by the connect command: logs in once and keeps only the returned token (REQ-ADM-012).
  app.post("/api/device-tokens", async (req, reply) => {
    const body = credentials.extend({ label: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "invalid_request");
    const result = await guard.check(body.data.loginId, body.data.password);
    if (result === 429) return fail(reply, 429, "too_many_attempts");
    if (result === 401) return fail(reply, 401, "invalid_credentials");
    // A temporary password must be replaced in the browser before connecting a computer.
    if (result.must_change_password === 1) return fail(reply, 403, "password_change_required");
    const token = randomToken();
    const id = store.createDeviceToken(result.id, body.data.label, sha256(token));
    return { id, token };
  });

  app.get("/api/me/device-tokens", async (req) => ({ tokens: store.deviceTokens(req.member.id) }));

  app.delete("/api/me/device-tokens/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!store.revokeDeviceToken(req.member.id, id)) return fail(reply, 404, "not_found");
    return { ok: true };
  });
}

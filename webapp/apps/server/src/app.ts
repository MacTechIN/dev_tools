import fs from "node:fs";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Config } from "./config";
import type { Db } from "./db";
import { authRoutes } from "./routes/auth";
import { eventRoutes } from "./routes/events";
import { memberRoutes } from "./routes/members";
import { streamRoutes } from "./routes/stream";
import { hashPassword, MIN_PASSWORD_LENGTH, sha256 } from "./security";
import { Store, type MemberRow } from "./store";

declare module "fastify" {
  interface FastifyRequest {
    member: MemberRow;
    authKind: "web" | "device";
  }
}

export const COOKIE_NAME = "sid";

/** Routes that need no login. */
const PUBLIC = new Set(["POST /api/login", "POST /api/device-tokens", "GET /api/health", "HEAD /api/health"]);
/** The only routes a device token (used by adapters) may call. */
const DEVICE_ALLOWED = new Set(["POST /api/events", "GET /api/me"]);
/** Routes still usable while a temporary password has not been changed. */
const BEFORE_PASSWORD_CHANGE = new Set(["GET /api/me", "PUT /api/me/password", "POST /api/logout"]);

export interface AppContext {
  store: Store;
  config: Config;
  /** Queues a "member" change for the dashboard, at most one per member per delay window. */
  touchMember(memberId: number, immediate?: boolean): void;
}

export interface BuildOptions {
  db: Db;
  config: Config;
  /** 0 publishes member changes synchronously (used by tests). */
  memberChangeDelayMs?: number;
}

export function fail(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

export async function buildApp(options: BuildOptions): Promise<{ app: FastifyInstance; store: Store }> {
  const { config } = options;
  const store = new Store(options.db);
  // Open event streams never go idle, so shutdown has to close them itself.
  const app = Fastify({ logger: false, bodyLimit: 1_000_000, forceCloseConnections: true });
  await app.register(cookie);

  const delay = options.memberChangeDelayMs ?? 1000;
  const pending = new Map<number, NodeJS.Timeout>();
  const publish = (memberId: number) => {
    pending.delete(memberId);
    store.addChange({ type: "member", payload: store.memberView(memberId) });
  };
  const ctx: AppContext = {
    store,
    config,
    touchMember(memberId, immediate = false) {
      if (immediate || delay === 0) {
        clearTimeout(pending.get(memberId));
        publish(memberId);
      } else if (!pending.has(memberId)) {
        pending.set(memberId, setTimeout(publish, delay, memberId).unref());
      }
    },
  };
  app.addHook("onClose", async () => {
    for (const t of pending.values()) clearTimeout(t);
    store.removeAllListeners();
  });

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const route = `${req.method} ${req.routeOptions.url ?? ""}`;
    if (!route.includes(" /api/") || PUBLIC.has(route)) return;

    const sid = req.cookies[COOKIE_NAME];
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    let member: MemberRow | undefined;
    if (bearer) {
      member = store.memberByDeviceToken(sha256(bearer));
      req.authKind = "device";
    } else if (sid) {
      member = store.memberByWebSession(sha256(sid));
      req.authKind = "web";
    }
    if (!member) return fail(reply, 401, "unauthorized");
    if (req.authKind === "device" && !DEVICE_ALLOWED.has(route)) return fail(reply, 403, "forbidden");
    if (req.authKind === "web" && member.must_change_password === 1 && !BEFORE_PASSWORD_CHANGE.has(route)) {
      return fail(reply, 403, "password_change_required");
    }
    req.member = member;
  });

  app.get("/api/health", async () => ({ ok: true }));
  authRoutes(app, ctx);
  memberRoutes(app, ctx);
  eventRoutes(app, ctx);
  streamRoutes(app, ctx);

  const hasWeb = fs.existsSync(config.webDist);
  if (hasWeb) await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || !hasWeb || req.method !== "GET") return fail(reply, 404, "not_found");
    return reply.sendFile("index.html");
  });

  return { app, store };
}

/** Creates the first admin from the environment when the team is still empty. */
export async function ensureAdmin(store: Store, config: Config): Promise<"created" | "exists" | "missing" | "weak"> {
  if (store.memberCount() > 0) return "exists";
  if (!config.admin) return "missing";
  if (config.admin.password.length < MIN_PASSWORD_LENGTH) return "weak";
  store.createMember({
    loginId: config.admin.loginId,
    name: config.admin.name,
    passwordHash: await hashPassword(config.admin.password),
    roles: ["admin", "lead", "dev"],
    mustChangePassword: false,
  });
  return "created";
}

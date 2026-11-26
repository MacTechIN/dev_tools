import type { Change } from "@devtools/shared";
import type { FastifyInstance } from "fastify";
import { COOKIE_NAME, type AppContext } from "../app";
import { sha256 } from "../security";

const HEARTBEAT_MS = 25_000;

export function streamRoutes(app: FastifyInstance, { store }: AppContext) {
  // Server-sent events. On reconnect the browser sends Last-Event-ID and receives only what it missed (REQ-NFR-005).
  app.get("/api/stream", (req, reply) => {
    const header = req.headers["last-event-id"];
    const since = Number(header ?? (req.query as { since?: string }).since ?? 0) || 0;
    const memberId = req.member.id;
    // Streams are web-only (device tokens cannot reach this route), so a session cookie is always present.
    const sessionHash = sha256(req.cookies[COOKIE_NAME] ?? "");
    let closed = false;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    // Sends the headers now; otherwise the browser waits until the first change arrives.
    res.write(": connected\n\n");

    const close = () => {
      if (closed) return;
      closed = true;
      res.end();
    };
    const send = (seq: number, change: Change) => {
      if (!closed) res.write(`id: ${seq}\nevent: ${change.type}\ndata: ${JSON.stringify(change.payload)}\n\n`);
    };
    // Resting, a password reset, logout elsewhere: the stream ends with the session (REQ-ADM-008).
    const onRevoked = (id: number, keep?: string) => {
      if (id === memberId && keep !== sessionHash) close();
    };
    const onSessionEnded = (hash: string) => {
      if (hash === sessionHash) close();
    };

    const backlog = store.changesSince(since);
    if (backlog === null) send(store.lastChangeSeq(), { type: "resync", payload: null });
    else for (const { seq, change } of backlog) send(seq, change);

    store.on("change", send);
    store.on("revoked", onRevoked);
    store.on("session-ended", onSessionEnded);
    const heartbeat = setInterval(() => {
      // Also catches session expiry.
      if (!store.memberByWebSession(sessionHash)) close();
      else res.write(": ping\n\n");
    }, HEARTBEAT_MS);
    const cleanup = () => {
      closed = true;
      clearInterval(heartbeat);
      store.off("change", send);
      store.off("revoked", onRevoked);
      store.off("session-ended", onSessionEnded);
    };
    req.raw.on("close", cleanup);
    res.on("close", cleanup);
  });
}

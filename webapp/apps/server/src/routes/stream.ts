import type { Change } from "@devtools/shared";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app";

const HEARTBEAT_MS = 25_000;

export function streamRoutes(app: FastifyInstance, { store }: AppContext) {
  // Server-sent events. On reconnect the browser sends Last-Event-ID and receives only what it missed (REQ-NFR-005).
  app.get("/api/stream", (req, reply) => {
    const header = req.headers["last-event-id"];
    const since = Number(header ?? (req.query as { since?: string }).since ?? 0) || 0;
    const memberId = req.member.id;

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

    const send = (seq: number, change: Change) => {
      res.write(`id: ${seq}\nevent: ${change.type}\ndata: ${JSON.stringify(change.payload)}\n\n`);
      // A member who was just set to resting loses the stream too.
      if (change.type === "member" && change.payload.id === memberId && !change.payload.active) res.end();
    };

    const backlog = store.changesSince(since);
    if (backlog === null) send(store.lastChangeSeq(), { type: "resync", payload: null });
    else for (const { seq, change } of backlog) send(seq, change);

    store.on("change", send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    const cleanup = () => {
      clearInterval(heartbeat);
      store.off("change", send);
    };
    req.raw.on("close", cleanup);
    res.on("close", cleanup);
  });
}

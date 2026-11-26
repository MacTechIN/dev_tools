import { eventBatchSchema, eventSchema, type Snapshot, type ToolEvent } from "@devtools/shared";
import type { FastifyInstance } from "fastify";
import { fail, type AppContext } from "../app";
import { toMe } from "./auth";

export function eventRoutes(app: FastifyInstance, { store, touchMember }: AppContext) {
  // The member always comes from the token, never from the request body.
  app.post("/api/events", async (req, reply) => {
    const batch = eventBatchSchema.safeParse(req.body);
    if (!batch.success) return fail(reply, 400, "invalid_request");
    const events: ToolEvent[] = [];
    let rejected = 0;
    for (const raw of batch.data.events) {
      const parsed = eventSchema.safeParse(raw);
      if (parsed.success) events.push(parsed.data);
      else rejected++;
    }
    const { stored, feed } = store.insertEvents(req.member, events);
    for (const item of feed) store.addChange({ type: "feed", payload: item });
    if (stored > 0) touchMember(req.member.id);
    return { stored, duplicates: events.length - stored, rejected };
  });

  app.get("/api/snapshot", async (req): Promise<Snapshot> => {
    // Read the sequence first: a change arriving meanwhile is then delivered twice rather than lost.
    const seq = store.lastChangeSeq();
    return { me: toMe(req.member), members: store.memberViews(), feed: store.recentFeed(50), seq };
  });
}

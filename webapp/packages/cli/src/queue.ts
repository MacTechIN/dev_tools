import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config";

/** Stop queueing once this much is waiting, so a long outage cannot fill the disk. */
const MAX_QUEUE_BYTES = 5 * 1024 * 1024;
const BATCH = 500;
const LOCK_STALE_MS = 60_000;

const queueFile = (home: string) => path.join(home, "queue.jsonl");
const inflightFile = (home: string) => path.join(home, "inflight.jsonl");
const lockFile = (home: string) => path.join(home, "flush.lock");

function size(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Number of events waiting to be sent. */
export function pendingCount(home: string): number {
  let n = 0;
  for (const f of [inflightFile(home), queueFile(home)]) {
    try {
      n += fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length;
    } catch {
      // missing file
    }
  }
  return n;
}

/** Appends events for a later send. Returns false if the queue is full and they were dropped. */
export function enqueue(home: string, events: readonly unknown[]): boolean {
  if (events.length === 0) return true;
  if (size(queueFile(home)) + size(inflightFile(home)) > MAX_QUEUE_BYTES) return false;
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.appendFileSync(queueFile(home), events.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
  return true;
}

function acquireLock(home: string): boolean {
  const file = lockFile(home);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
      return true;
    } catch {
      // Someone else holds it; take it over only if it was left behind by a crash.
      if (Date.now() - (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) < LOCK_STALE_MS) return false;
      fs.rmSync(file, { force: true });
    }
  }
  return false;
}

export type FlushResult = "sent" | "empty" | "busy" | "offline" | "unauthorized";

/**
 * Sends everything queued. Only one flush runs at a time. New events keep going
 * to the queue file while a batch is in flight, because the flush first renames
 * the queue aside. Unsent lines stay on disk for the next try (REQ-COL-008).
 */
export async function flush(home: string, cfg: Config, fetchImpl: typeof fetch = fetch): Promise<FlushResult> {
  if (!acquireLock(home)) return "busy";
  let result: FlushResult = "empty";
  try {
    for (;;) {
      const inflight = inflightFile(home);
      if (!fs.existsSync(inflight)) {
        if (!fs.existsSync(queueFile(home))) return result;
        fs.renameSync(queueFile(home), inflight);
      }
      const lines = fs.readFileSync(inflight, "utf8").split("\n").filter(Boolean);
      const events = lines.flatMap((l) => {
        try {
          return [JSON.parse(l) as unknown];
        } catch {
          return []; // a line cut short by a crash
        }
      });
      for (let i = 0; i < events.length; i += BATCH) {
        let res: Response;
        try {
          res = await fetchImpl(new URL("/api/events", cfg.server), {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
            body: JSON.stringify({ events: events.slice(i, i + BATCH) }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch {
          res = new Response(null, { status: 599 });
        }
        // A batch the server rejects as malformed would fail forever; drop it instead of blocking the rest.
        if (res.status === 400 || res.status === 413) continue;
        if (!res.ok) {
          const rest = events.slice(i).map((e) => JSON.stringify(e)).join("\n") + "\n";
          fs.writeFileSync(inflight, rest, { mode: 0o600 });
          return res.status === 401 || res.status === 403 ? "unauthorized" : "offline";
        }
      }
      fs.rmSync(inflight, { force: true });
      result = "sent";
    }
  } finally {
    fs.rmSync(lockFile(home), { force: true });
  }
}

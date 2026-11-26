import { z } from "zod";

/** AI coding tools (and git) that can produce events. */
export const TOOLS = ["claude-code", "codex", "kimi", "gemini", "git"] as const;
export type Tool = (typeof TOOLS)[number];

const base = {
  /** Unique per member; a repeated id is stored only once. */
  id: z.string().min(1).max(200),
  tool: z.enum(TOOLS),
  session: z.string().min(1).max(200),
  at: z.iso.datetime({ offset: true }),
  cwd: z.string().max(500).optional(),
  branch: z.string().max(300).optional(),
};

const path = z.string().max(500);
const requirementId = z.string().regex(/^REQ-[A-Z]+-\d{3}$/);

function ev<K extends string, D extends z.ZodType>(kind: K, data: D) {
  return z.object({ ...base, kind: z.literal(kind), data: data.default({} as never) });
}

/**
 * The common event format. Every adapter converts its tool's events into this.
 * Objects strip unknown keys, so prompt text, responses and file contents that
 * an adapter might send by mistake are never stored (REQ-COL-006).
 */
export const eventSchema = z.discriminatedUnion("kind", [
  ev("session.start", z.object({ toolVersion: z.string().max(50).optional() })),
  ev("session.end", z.object({ reason: z.string().max(100).optional() })),
  ev("session.idle", z.object({})),
  ev("turn.start", z.object({})),
  ev("turn.end", z.object({})),
  ev("file.change", z.object({ paths: z.array(path).max(200).default([]) })),
  ev(
    "command.run",
    z.object({ category: z.enum(["test", "build", "other"]).default("other"), ok: z.boolean().optional() }),
  ),
  ev(
    "test.result",
    z.object({
      passed: z.number().int().min(0),
      failed: z.number().int().min(0),
      failedNames: z.array(z.string().max(300)).max(100).optional(),
      requirementIds: z.array(requirementId).max(200).optional(),
    }),
  ),
  ev(
    "git.commit",
    z.object({ hash: z.string().max(64), subject: z.string().max(300), paths: z.array(path).max(500).optional() }),
  ),
  ev("git.branch", z.object({ from: z.string().max(300).optional(), to: z.string().max(300) })),
]);

export type ToolEvent = z.infer<typeof eventSchema>;
export type EventKind = ToolEvent["kind"];

export const eventBatchSchema = z.object({ events: z.array(z.unknown()).min(1).max(500) });

/** Kinds shown in the activity feed. File edits are too frequent to list one by one. */
export const FEED_KINDS: readonly EventKind[] = ["session.start", "session.end", "test.result", "git.commit"];

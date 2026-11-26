import { describe, expect, test } from "vitest";
import { deriveWorkState, derivePresence, eventSchema } from "./index";

describe("deriveWorkState", () => {
  // Mirrors the table in docs/tech_design.md section 5.
  test.each([
    ["approved", "none", true, "done"],
    ["approval_requested", "partial", true, "checking"],
    ["active", "none", true, "doing"],
    [null, "none", false, "blocked"],
    [null, "none", true, "empty"],
    [null, "partial", true, "empty"],
    [null, "done", true, "hidden"],
  ] as const)("REQ-TSK-008: claim=%s impl=%s depsDone=%s -> %s", (claim, impl, depsDone, expected) => {
    expect(deriveWorkState({ claim, impl, depsDone })).toBe(expected);
  });
});

describe("derivePresence", () => {
  const now = Date.parse("2026-11-26T10:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();

  test("REQ-DSH-002: recent activity in an open session is working", () => {
    expect(derivePresence({ lastEventAt: ago(1), openSession: true, now })).toBe("working");
  });
  test("REQ-DSH-002: a quiet open session is idle", () => {
    expect(derivePresence({ lastEventAt: ago(10), openSession: true, now })).toBe("idle");
  });
  test("REQ-DSH-008: an open session silent for a long time is lost", () => {
    expect(derivePresence({ lastEventAt: ago(45), openSession: true, now })).toBe("lost");
  });
  test("REQ-DSH-002: no open session is offline", () => {
    expect(derivePresence({ lastEventAt: ago(1), openSession: false, now })).toBe("offline");
  });
});

describe("eventSchema", () => {
  const base = { id: "e1", tool: "codex", session: "s1", at: "2026-11-26T10:00:00Z" };

  test("REQ-COL-006: prompt and file bodies are stripped from events", () => {
    const parsed = eventSchema.parse({
      ...base,
      kind: "file.change",
      prompt: "secret prompt",
      data: { paths: ["a.ts"], content: "secret code" },
    });
    expect(parsed).not.toHaveProperty("prompt");
    expect(parsed.data).toEqual({ paths: ["a.ts"] });
  });

  test("REQ-COL-004: an unknown kind is rejected", () => {
    expect(eventSchema.safeParse({ ...base, kind: "nope", data: {} }).success).toBe(false);
  });

  test("REQ-COL-004: data may be omitted", () => {
    expect(eventSchema.parse({ ...base, kind: "turn.end" }).data).toEqual({});
  });
});

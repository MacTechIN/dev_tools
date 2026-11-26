/** Implementation status of a requirement (first axis). */
export type ImplStatus = "none" | "partial" | "done";
/** State of the current claim on a requirement, if any (second axis). */
export type ClaimState = "active" | "approval_requested" | "approved" | null;
/** What the UI shows. Never stored; always derived from the two axes. */
export type WorkState = "done" | "checking" | "doing" | "blocked" | "empty" | "hidden";

export function deriveWorkState(input: { impl: ImplStatus; claim: ClaimState; depsDone: boolean }): WorkState {
  if (input.claim === "approved") return "done";
  if (input.claim === "approval_requested") return "checking";
  if (input.claim === "active") return "doing";
  if (!input.depsDone) return "blocked";
  if (input.impl === "done") return "hidden";
  return "empty";
}

/** How a teammate's row is labelled on the home screen. */
export type Presence = "working" | "idle" | "lost" | "offline";

export const PRESENCE_IDLE_AFTER_MS = 5 * 60_000;
export const PRESENCE_LOST_AFTER_MS = 30 * 60_000;

export function derivePresence(input: {
  lastEventAt: string | null;
  openSession: boolean;
  now: number;
  idleAfterMs?: number;
  lostAfterMs?: number;
}): Presence {
  if (!input.openSession || !input.lastEventAt) return "offline";
  const age = input.now - Date.parse(input.lastEventAt);
  if (age < (input.idleAfterMs ?? PRESENCE_IDLE_AFTER_MS)) return "working";
  if (age < (input.lostAfterMs ?? PRESENCE_LOST_AFTER_MS)) return "idle";
  return "lost";
}

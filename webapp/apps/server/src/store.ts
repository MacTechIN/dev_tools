import { EventEmitter } from "node:events";
import {
  FEED_KINDS,
  ROLES,
  type Change,
  type DeviceTokenView,
  type EventKind,
  type FeedItem,
  type MemberView,
  type Role,
  type Tool,
  type ToolEvent,
} from "@devtools/shared";
import type { Db } from "./db";

export interface MemberRow {
  id: number;
  login_id: string;
  name: string;
  password_hash: string;
  roles: string;
  active: number;
  must_change_password: number;
  status_note: string;
}

const KEEP_CHANGES = 5000;
/** Event times further in the future than this are clamped, so a bad clock cannot pin a member as working. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const TOOLS_WINDOW_DAYS = 30;

export function parseRoles(raw: string): Role[] {
  const list = JSON.parse(raw) as string[];
  return ROLES.filter((r) => list.includes(r));
}

/** All database access. Emits "change" for every row added to the change log. */
export class Store extends EventEmitter {
  constructor(readonly db: Db) {
    super();
    this.setMaxListeners(0);
  }

  // ---- members -----------------------------------------------------------

  memberCount(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM members").get() as { n: number }).n;
  }

  memberById(id: number): MemberRow | undefined {
    return this.db.prepare("SELECT * FROM members WHERE id = ?").get(id) as MemberRow | undefined;
  }

  memberByLoginId(loginId: string): MemberRow | undefined {
    return this.db.prepare("SELECT * FROM members WHERE login_id = ?").get(loginId) as MemberRow | undefined;
  }

  createMember(input: {
    loginId: string;
    name: string;
    passwordHash: string;
    roles: Role[];
    mustChangePassword: boolean;
  }): MemberRow {
    const info = this.db
      .prepare(
        "INSERT INTO members (login_id, name, password_hash, roles, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.loginId,
        input.name,
        input.passwordHash,
        JSON.stringify(input.roles),
        input.mustChangePassword ? 1 : 0,
        new Date().toISOString(),
      );
    return this.memberById(Number(info.lastInsertRowid))!;
  }

  updateMember(
    id: number,
    patch: Partial<{
      name: string;
      roles: Role[];
      active: boolean;
      passwordHash: string;
      mustChangePassword: boolean;
      statusNote: string;
    }>,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.roles !== undefined) set("roles", JSON.stringify(patch.roles));
    if (patch.active !== undefined) set("active", patch.active ? 1 : 0);
    if (patch.passwordHash !== undefined) set("password_hash", patch.passwordHash);
    if (patch.mustChangePassword !== undefined) set("must_change_password", patch.mustChangePassword ? 1 : 0);
    if (patch.statusNote !== undefined) set("status_note", patch.statusNote);
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  activeAdminCount(exceptId?: number): number {
    const rows = this.db.prepare("SELECT id, roles FROM members WHERE active = 1").all() as MemberRow[];
    return rows.filter((m) => m.id !== exceptId && parseRoles(m.roles).includes("admin")).length;
  }

  /**
   * Signs a member out everywhere except, optionally, one web session.
   * Emits "revoked" so open event streams of that member close.
   */
  revokeAccess(memberId: number, keepSessionHash?: string): void {
    const now = new Date().toISOString();
    this.db.prepare("DELETE FROM web_sessions WHERE member_id = ? AND id_hash != ?").run(memberId, keepSessionHash ?? "");
    this.db
      .prepare("UPDATE device_tokens SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL")
      .run(now, memberId);
    this.emit("revoked", memberId, keepSessionHash);
  }

  memberView(id: number): MemberView {
    const m = this.memberById(id)!;
    const since = new Date(Date.now() - TOOLS_WINDOW_DAYS * 86_400_000).toISOString();
    const tools = (
      this.db
        .prepare("SELECT DISTINCT tool FROM sessions WHERE member_id = ? AND tool != 'git' AND last_event_at > ? ORDER BY tool")
        .all(id, since) as { tool: Tool }[]
    ).map((r) => r.tool);
    const s = this.db
      .prepare("SELECT * FROM sessions WHERE member_id = ? AND tool != 'git' ORDER BY last_event_at DESC LIMIT 1")
      .get(id) as
      | { tool: Tool; id: string; ended_at: string | null; last_event_at: string; last_kind: EventKind; branch: string | null }
      | undefined;
    let current: MemberView["current"] = null;
    if (s) {
      const rows = this.db
        .prepare(
          "SELECT data FROM events WHERE member_id = ? AND tool = ? AND session = ? AND kind = 'file.change' ORDER BY seq DESC LIMIT 200",
        )
        .all(id, s.tool, s.id) as { data: string }[];
      const paths = new Set<string>();
      for (const r of rows) for (const p of (JSON.parse(r.data) as { paths?: string[] }).paths ?? []) paths.add(p);
      current = {
        tool: s.tool,
        branch: s.branch,
        open: s.ended_at === null,
        lastEventAt: s.last_event_at,
        lastKind: s.last_kind,
        filesChanged: paths.size,
      };
    }
    return {
      id: m.id,
      loginId: m.login_id,
      name: m.name,
      roles: parseRoles(m.roles),
      active: m.active === 1,
      statusNote: m.status_note,
      tools,
      current,
    };
  }

  memberViews(): MemberView[] {
    const ids = this.db.prepare("SELECT id FROM members ORDER BY name").all() as { id: number }[];
    return ids.map((r) => this.memberView(r.id));
  }

  // ---- web sessions and device tokens ------------------------------------

  createWebSession(idHash: string, memberId: number, days: number): void {
    const now = Date.now();
    this.db
      .prepare("INSERT INTO web_sessions (id_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(idHash, memberId, new Date(now).toISOString(), new Date(now + days * 86_400_000).toISOString());
  }

  memberByWebSession(idHash: string): MemberRow | undefined {
    return this.db
      .prepare(
        "SELECT m.* FROM web_sessions w JOIN members m ON m.id = w.member_id WHERE w.id_hash = ? AND w.expires_at > ? AND m.active = 1",
      )
      .get(idHash, new Date().toISOString()) as MemberRow | undefined;
  }

  deleteWebSession(idHash: string): void {
    this.db.prepare("DELETE FROM web_sessions WHERE id_hash = ?").run(idHash);
    this.emit("session-ended", idHash);
  }

  createDeviceToken(memberId: number, label: string, tokenHash: string): number {
    const info = this.db
      .prepare("INSERT INTO device_tokens (member_id, label, token_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(memberId, label, tokenHash, new Date().toISOString());
    return Number(info.lastInsertRowid);
  }

  memberByDeviceToken(tokenHash: string): MemberRow | undefined {
    const row = this.db
      .prepare(
        "SELECT m.*, t.id AS token_id FROM device_tokens t JOIN members m ON m.id = t.member_id WHERE t.token_hash = ? AND t.revoked_at IS NULL AND m.active = 1",
      )
      .get(tokenHash) as (MemberRow & { token_id: number }) | undefined;
    if (row) this.db.prepare("UPDATE device_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.token_id);
    return row;
  }

  deviceTokens(memberId: number): DeviceTokenView[] {
    return (
      this.db
        .prepare("SELECT id, label, created_at, last_used_at FROM device_tokens WHERE member_id = ? AND revoked_at IS NULL ORDER BY id DESC")
        .all(memberId) as { id: number; label: string; created_at: string; last_used_at: string | null }[]
    ).map((t) => ({ id: t.id, label: t.label, createdAt: t.created_at, lastUsedAt: t.last_used_at }));
  }

  revokeDeviceToken(memberId: number, tokenId: number): boolean {
    const info = this.db
      .prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ? AND member_id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), tokenId, memberId);
    return info.changes > 0;
  }

  // ---- events ------------------------------------------------------------

  /** Stores events in arrival order. Returns the feed items created; repeated ids are ignored. */
  insertEvents(member: MemberRow, events: ToolEvent[]): { stored: number; feed: FeedItem[] } {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO events (id, member_id, tool, session, kind, at, cwd, branch, data, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const upsertSession = this.db.prepare(
      `INSERT INTO sessions (member_id, tool, id, started_at, last_event_at, last_kind, branch, ended_at)
       VALUES (@member, @tool, @id, @at, @at, @kind, @branch, @ended)
       ON CONFLICT (member_id, tool, id) DO UPDATE SET
         last_event_at = max(last_event_at, @at),
         last_kind = CASE WHEN @at >= last_event_at THEN @kind ELSE last_kind END,
         branch = coalesce(@branch, branch),
         ended_at = CASE
           WHEN @kind = 'session.end' THEN CASE WHEN @at >= last_event_at THEN @at ELSE ended_at END
           WHEN @at > coalesce(ended_at, '') THEN NULL
           ELSE ended_at END`,
    );
    const feed: FeedItem[] = [];
    let stored = 0;
    this.db.transaction(() => {
      const receivedAt = new Date().toISOString();
      const latest = Date.now() + MAX_CLOCK_SKEW_MS;
      for (const e of events) {
        const at = new Date(Math.min(Date.parse(e.at), latest)).toISOString();
        const info = insert.run(e.id, member.id, e.tool, e.session, e.kind, at, e.cwd ?? null, e.branch ?? null, JSON.stringify(e.data), receivedAt);
        if (info.changes === 0) continue;
        stored++;
        upsertSession.run({
          member: member.id,
          tool: e.tool,
          id: e.session,
          at,
          kind: e.kind,
          branch: e.branch ?? null,
          ended: e.kind === "session.end" ? at : null,
        });
        if (FEED_KINDS.includes(e.kind)) {
          feed.push({
            seq: Number(info.lastInsertRowid),
            memberId: member.id,
            memberName: member.name,
            tool: e.tool,
            kind: e.kind,
            at,
            data: e.data as Record<string, unknown>,
          });
        }
      }
    })();
    return { stored, feed };
  }

  eventCount(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
  }

  recentFeed(limit: number): FeedItem[] {
    const kinds = FEED_KINDS.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT e.seq, e.member_id, m.name, e.tool, e.kind, e.at, e.data FROM events e JOIN members m ON m.id = e.member_id
         WHERE e.kind IN (${kinds}) ORDER BY e.seq DESC LIMIT ?`,
      )
      .all(...FEED_KINDS, limit) as { seq: number; member_id: number; name: string; tool: Tool; kind: EventKind; at: string; data: string }[];
    return rows.map((r) => ({
      seq: r.seq,
      memberId: r.member_id,
      memberName: r.name,
      tool: r.tool,
      kind: r.kind,
      at: r.at,
      data: JSON.parse(r.data) as Record<string, unknown>,
    }));
  }

  // ---- change log (what the dashboard receives over SSE) ------------------

  addChange(change: Change): number {
    const info = this.db
      .prepare("INSERT INTO changes (type, payload, at) VALUES (?, ?, ?)")
      .run(change.type, JSON.stringify(change.payload), new Date().toISOString());
    const seq = Number(info.lastInsertRowid);
    if (seq % 500 === 0) this.db.prepare("DELETE FROM changes WHERE seq <= ?").run(seq - KEEP_CHANGES);
    this.emit("change", seq, change);
    return seq;
  }

  lastChangeSeq(): number {
    return (this.db.prepare("SELECT coalesce(max(seq), 0) AS n FROM changes").get() as { n: number }).n;
  }

  /** Changes after `since`, or null when they were already pruned and the client must reload. */
  changesSince(since: number): { seq: number; change: Change }[] | null {
    // A client ahead of the server (e.g. after a restore from backup) holds state the server no longer has.
    if (since > this.lastChangeSeq()) return null;
    const oldest = (this.db.prepare("SELECT coalesce(min(seq), 0) AS n FROM changes").get() as { n: number }).n;
    if (oldest > since + 1) return null;
    const rows = this.db.prepare("SELECT seq, type, payload FROM changes WHERE seq > ? ORDER BY seq").all(since) as {
      seq: number;
      type: Change["type"];
      payload: string;
    }[];
    return rows.map((r) => ({ seq: r.seq, change: { type: r.type, payload: JSON.parse(r.payload) } as Change }));
  }
}

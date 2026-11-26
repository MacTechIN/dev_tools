import type { EventKind, Tool } from "./events";

export const ROLES = ["admin", "lead", "dev"] as const;
export type Role = (typeof ROLES)[number];

export interface MemberView {
  id: number;
  loginId: string;
  name: string;
  roles: Role[];
  active: boolean;
  statusNote: string;
  /** Tools this member has sent events from recently. */
  tools: Tool[];
  current: {
    tool: Tool;
    branch: string | null;
    open: boolean;
    lastEventAt: string;
    lastKind: EventKind;
    filesChanged: number;
  } | null;
}

export interface FeedItem {
  seq: number;
  memberId: number;
  memberName: string;
  tool: Tool;
  kind: EventKind;
  at: string;
  data: Record<string, unknown>;
}

export interface Me {
  id: number;
  loginId: string;
  name: string;
  roles: Role[];
  mustChangePassword: boolean;
}

export interface Snapshot {
  me: Me;
  members: MemberView[];
  feed: FeedItem[];
  /** Pass to /api/stream?since= to receive only later changes. */
  seq: number;
}

export type Change =
  | { type: "member"; payload: MemberView }
  | { type: "feed"; payload: FeedItem }
  | { type: "resync"; payload: null };

export interface DeviceTokenView {
  id: number;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

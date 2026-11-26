import type { FeedItem, MemberView, Snapshot } from "@devtools/shared";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

export interface Live {
  members: MemberView[];
  feed: FeedItem[];
  connected: boolean;
  /** Ticks every 15 seconds so "3분 전" and presence labels stay current. */
  now: number;
}

const FEED_LIMIT = 200;

/** Loads the snapshot once, then applies changes from the server-sent event stream. */
export function useLive(onSignedOut: () => void): Live | null {
  const [state, setState] = useState<Omit<Live, "now"> | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let source: EventSource | undefined;
    let stopped = false;

    async function start() {
      let snap: Snapshot;
      try {
        snap = await api<Snapshot>("GET", "/api/snapshot");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onSignedOut();
        return;
      }
      if (stopped) return;
      setState({ members: snap.members, feed: snap.feed, connected: true });

      source = new EventSource(`/api/stream?since=${snap.seq}`);
      source.onopen = () => setState((s) => s && { ...s, connected: true });
      source.onerror = () => {
        setState((s) => s && { ...s, connected: false });
        // The browser reconnects by itself; only a lost login needs handling here.
        api("GET", "/api/me").catch((e) => {
          if (e instanceof ApiError && e.status === 401) onSignedOut();
        });
      };
      source.addEventListener("member", (e) => {
        const member = JSON.parse((e as MessageEvent<string>).data) as MemberView;
        setState((s) => {
          if (!s) return s;
          const others = s.members.filter((m) => m.id !== member.id);
          return { ...s, members: [...others, member] };
        });
      });
      source.addEventListener("feed", (e) => {
        const item = JSON.parse((e as MessageEvent<string>).data) as FeedItem;
        setState((s) => {
          if (!s || s.feed.some((f) => f.seq === item.seq)) return s;
          return { ...s, feed: [item, ...s.feed].slice(0, FEED_LIMIT) };
        });
      });
      source.addEventListener("resync", () => {
        source?.close();
        void start();
      });
    }

    void start();
    return () => {
      stopped = true;
      source?.close();
    };
  }, [onSignedOut]);

  return state && { ...state, now };
}

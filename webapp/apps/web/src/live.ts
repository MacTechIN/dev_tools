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
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Loads the snapshot, then applies changes from the server-sent event stream.
 * EventSource retries network errors by itself but gives up on any non-200 answer
 * (a proxy's 502 during a restart, say), so a closed stream starts over here.
 */
export function useLive(onSignedOut: () => void): Live | null {
  const [state, setState] = useState<Omit<Live, "now"> | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let source: EventSource | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = RETRY_MIN_MS;
    let stopped = false;

    const setConnected = (connected: boolean) => setState((s) => s && { ...s, connected });

    function restartLater() {
      source?.close();
      source = undefined;
      setConnected(false);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void start(), retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    }

    async function start() {
      if (stopped) return;
      let snap: Snapshot;
      try {
        snap = await api<Snapshot>("GET", "/api/snapshot");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onSignedOut();
        else restartLater();
        return;
      }
      if (stopped) return;
      setState({ members: snap.members, feed: snap.feed, connected: true });

      const es = new EventSource(`/api/stream?since=${snap.seq}`);
      source = es;
      es.onopen = () => {
        retryMs = RETRY_MIN_MS;
        setConnected(true);
      };
      es.onerror = () => {
        setConnected(false);
        if (es.readyState === EventSource.CLOSED) restartLater();
        // The server also ends the stream when the session is gone; the snapshot request then signs out.
      };
      es.addEventListener("member", (e) => {
        const member = JSON.parse((e as MessageEvent<string>).data) as MemberView;
        setState((s) => s && { ...s, members: [...s.members.filter((m) => m.id !== member.id), member] });
      });
      es.addEventListener("feed", (e) => {
        const item = JSON.parse((e as MessageEvent<string>).data) as FeedItem;
        setState((s) => {
          if (!s || s.feed.some((f) => f.seq === item.seq)) return s;
          return { ...s, feed: [item, ...s.feed].slice(0, FEED_LIMIT) };
        });
      });
      es.addEventListener("resync", () => {
        es.close();
        source = undefined;
        setConnected(false);
        void start();
      });
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [onSignedOut]);

  return state && { ...state, now };
}

import { derivePresence, type Me, type MemberView, type Presence } from "@devtools/shared";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { ago } from "../format";
import type { Live } from "../live";
import { S } from "../strings";

const ORDER: Record<Presence, number> = { working: 0, idle: 1, lost: 2, offline: 3 };

export function presenceOf(m: MemberView, now: number): Presence {
  return derivePresence({ lastEventAt: m.current?.lastEventAt ?? null, openSession: m.current?.open ?? false, now });
}

export function Home({ me, live }: { me: Me; live: Live }) {
  const active = live.members
    .filter((m) => m.active)
    .map((m) => ({ m, presence: presenceOf(m, live.now) }))
    .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || a.m.name.localeCompare(b.m.name, "ko"));
  const resting = live.members.filter((m) => !m.active);
  const anyActivity = live.members.some((m) => m.current);

  return (
    <>
      <h1>{S.home.team}</h1>
      {!anyActivity && (
        <div className="panel empty">
          <b>{S.home.emptyTitle}</b>
          <p className="muted">{S.home.emptyBody}</p>
        </div>
      )}
      <ul className="rows">
        {active.map(({ m, presence }) => (
          <MemberRowItem key={m.id} m={m} presence={presence} now={live.now} mine={m.id === me.id} />
        ))}
      </ul>
      {resting.length > 0 && (
        <details className="resting">
          <summary>{S.home.resting(resting.length)}</summary>
          <ul className="rows">
            {resting.map((m) => (
              <li key={m.id} className="row muted">
                <span className="av">{m.name.slice(0, 1)}</span>
                <span className="grow">{m.name}</span>
                <span className="chip plain">{S.settings.restingChip}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function MemberRowItem({ m, presence, now, mine }: { m: MemberView; presence: Presence; now: number; mine: boolean }) {
  const c = m.current;
  const detail = c
    ? [
        S.tools[c.tool],
        ago(c.lastEventAt, now),
        presence === "working" ? (c.lastKind === "file.change" && c.filesChanged > 0 ? S.home.files(c.filesChanged) : S.activity[c.lastKind]) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : S.home.noActivity;

  return (
    <li className="row">
      <span className="av">{m.name.slice(0, 1)}</span>
      <span className="grow">
        <b>{m.name}</b>
        {mine && <span className="muted small"> ({S.home.you})</span>}
        {c?.branch && <span className="branch">{c.branch}</span>}
        <br />
        <span className="muted small">{detail}</span>
        {m.statusNote && !mine && <span className="note">“{m.statusNote}”</span>}
        {mine && <NoteEditor initial={m.statusNote} />}
      </span>
      <span className={`chip ${presence}`}>{S.presence[presence]}</span>
    </li>
  );
}

function NoteEditor({ initial }: { initial: string }) {
  const [note, setNote] = useState(initial);

  async function save(e: FormEvent) {
    e.preventDefault();
    await api("PUT", "/api/me/status", { note }).catch(() => undefined);
  }

  return (
    <form className="note-form" onSubmit={save}>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder={S.home.notePlaceholder} aria-label={S.home.notePlaceholder} />
      <button className="btn ghost">{S.home.noteSave}</button>
    </form>
  );
}

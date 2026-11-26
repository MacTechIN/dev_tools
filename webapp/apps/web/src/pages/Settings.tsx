import { ROLES, type DeviceTokenView, type Me, type MemberView, type Role } from "@devtools/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorCode } from "../api";
import { ago } from "../format";
import type { Live } from "../live";
import { errorText, S } from "../strings";
import { PasswordForm } from "./Login";

export function Settings({ me, live }: { me: Me; live: Live }) {
  const isAdmin = me.roles.includes("admin");
  const members = [...live.members].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ko"));
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [error, setError] = useState("");

  async function patch(m: MemberView, body: object) {
    setError("");
    try {
      const res = await api<{ tempPassword?: string }>("PATCH", `/api/members/${m.id}`, body);
      if (res.tempPassword) setIssued({ name: m.name, password: res.tempPassword });
    } catch (e) {
      setError(errorText(errorCode(e)));
    }
  }

  function toggleRole(m: MemberView, role: Role) {
    const next = m.roles.includes(role) ? m.roles.filter((r) => r !== role) : [...m.roles, role];
    if (next.length > 0) void patch(m, { roles: next });
  }

  return (
    <>
      <h1>{S.settings.members(members.length)}</h1>
      {issued && (
        <div className="panel notice" role="status">
          <b>{S.settings.tempPassword(issued.name, issued.password)}</b>
          <p className="muted small">{S.settings.tempPasswordHint}</p>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isAdmin && <AddMember onAdded={(name, password) => setIssued({ name, password })} />}
      <ul className="rows">
        {members.map((m) => (
          <li key={m.id} className={`row ${m.active ? "" : "muted"}`}>
            <span className="av">{m.name.slice(0, 1)}</span>
            <span className="grow">
              <b>{m.name}</b> <span className="muted small">{m.loginId}</span>
              <br />
              {isAdmin ? (
                <span className="roles">
                  {ROLES.map((r) => (
                    <label key={r}>
                      <input type="checkbox" checked={m.roles.includes(r)} onChange={() => toggleRole(m, r)} /> {S.roles[r]}
                    </label>
                  ))}
                </span>
              ) : (
                <span className="muted small">{m.roles.map((r) => S.roles[r]).join(" · ")}</span>
              )}
            </span>
            <span className="muted small">{m.tools.map((t) => S.tools[t]).join(" · ")}</span>
            {!m.active && <span className="chip plain">{S.settings.restingChip}</span>}
            {isAdmin && (
              <>
                <button className="btn ghost" onClick={() => patch(m, { resetPassword: true })}>
                  {S.settings.reset}
                </button>
                <button className="btn ghost" onClick={() => patch(m, { active: !m.active })}>
                  {m.active ? S.settings.rest : S.settings.wake}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">{S.settings.aiNote}</p>

      <Devices now={live.now} />

      <h2>{S.password.section}</h2>
      <PasswordDone />
    </>
  );
}

function AddMember({ onAdded }: { onAdded: (name: string, password: string) => void }) {
  const [loginId, setLoginId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await api<{ tempPassword: string }>("POST", "/api/members", { loginId, name, roles: ["dev"] });
      onAdded(name, res.tempPassword);
      setLoginId("");
      setName("");
    } catch (err) {
      setError(errorText(errorCode(err)));
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={S.settings.addName} aria-label={S.settings.addName} required />
      <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder={S.settings.addId} aria-label={S.settings.addId} pattern="[a-zA-Z0-9._\-]{2,40}" required />
      <button className="btn">{S.settings.add}</button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

function Devices({ now }: { now: number }) {
  const [tokens, setTokens] = useState<DeviceTokenView[] | null>(null);
  const load = () => api<{ tokens: DeviceTokenView[] }>("GET", "/api/me/device-tokens").then((r) => setTokens(r.tokens));

  useEffect(() => {
    void load();
  }, []);

  async function disconnect(id: number) {
    await api("DELETE", `/api/me/device-tokens/${id}`).catch(() => undefined);
    await load();
  }

  return (
    <>
      <h2>{S.settings.devices}</h2>
      {tokens?.length === 0 && <p className="muted">{S.settings.devicesEmpty}</p>}
      <ul className="rows">
        {tokens?.map((t) => (
          <li key={t.id} className="row">
            <span className="grow">
              <b>{t.label}</b>
              <br />
              <span className="muted small">
                {S.settings.lastUsed}: {t.lastUsedAt ? ago(t.lastUsedAt, now) : S.settings.never}
              </span>
            </span>
            <button className="btn ghost" onClick={() => disconnect(t.id)}>
              {S.settings.disconnect}
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">{S.settings.devicesHint}</p>
    </>
  );
}

function PasswordDone() {
  const [done, setDone] = useState(false);
  return (
    <>
      <PasswordForm onDone={() => setDone(true)} />
      {done && (
        <p className="muted" role="status">
          {S.password.done}
        </p>
      )}
    </>
  );
}

import type { Me } from "@devtools/shared";
import { useState, type FormEvent } from "react";
import { api, errorCode } from "../api";
import { errorText, S } from "../strings";

export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { me } = await api<{ me: Me }>("POST", "/api/login", { loginId, password });
      onLogin(me);
    } catch (err) {
      setError(errorText(errorCode(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-card">
      <h1>{S.login.title}</h1>
      <form onSubmit={submit} className="form">
        <label>
          {S.login.id}
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          {S.login.password}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {S.login.submit}
        </button>
      </form>
      <p className="muted small">{S.login.hint}</p>
    </main>
  );
}

export function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("PUT", "/api/me/password", { current, next });
      setCurrent("");
      setNext("");
      onDone();
    } catch (err) {
      setError(errorText(errorCode(err)));
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <label>
        {S.password.current}
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        {S.password.next}
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn">{S.password.submit}</button>
    </form>
  );
}

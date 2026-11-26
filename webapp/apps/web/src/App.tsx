import type { Me } from "@devtools/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useLive } from "./live";
import { Feed } from "./pages/Feed";
import { Home } from "./pages/Home";
import { Login, PasswordForm } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { S } from "./strings";

type Page = "home" | "feed" | "settings";

export function App() {
  // undefined: still checking, null: signed out
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api<{ me: Me }>("GET", "/api/me")
      .then((r) => setMe(r.me))
      .catch(() => setMe(null));
  }, []);

  const signedOut = useCallback(() => setMe(null), []);

  if (me === undefined) return <p className="center muted">{S.loading}</p>;
  if (me === null) return <Login onLogin={setMe} />;
  if (me.mustChangePassword) {
    return (
      <main className="center-card">
        <h1>{S.firstPassword.title}</h1>
        <p className="muted">{S.firstPassword.body}</p>
        <PasswordForm onDone={() => setMe({ ...me, mustChangePassword: false })} />
      </main>
    );
  }
  return <Shell me={me} onSignedOut={signedOut} />;
}

function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [page, setPage] = useState<Page>("home");
  const live = useLive(onSignedOut);

  async function logout() {
    await api("POST", "/api/logout").catch(() => undefined);
    onSignedOut();
  }

  return (
    <div className="shell">
      <nav className="side" aria-label="메뉴">
        <div className="proj">{S.appName}</div>
        {(["home", "feed", "settings"] as const).map((p) => (
          <button key={p} className={page === p ? "on" : ""} aria-current={page === p ? "page" : undefined} onClick={() => setPage(p)}>
            {S.nav[p]}
          </button>
        ))}
        <div className="spacer" />
        <div className="who">{me.name}</div>
        <button onClick={logout}>{S.logout}</button>
      </nav>
      <main className="content">
        {live && !live.connected && (
          <div className="banner" role="status">
            {S.reconnecting}
          </div>
        )}
        {!live && <p className="muted">{S.loading}</p>}
        {live && page === "home" && <Home me={me} live={live} />}
        {live && page === "feed" && <Feed live={live} />}
        {live && page === "settings" && <Settings me={me} live={live} />}
      </main>
    </div>
  );
}

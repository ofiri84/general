import type { IntegrationStatus, Me } from "@yachad/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { logout } from "../auth";
import { loadConfig } from "../config";
import { DriveIcon } from "./icons";

export function Settings({ me, notice, onLogout }: { me: Me; notice?: string; onLogout: () => void }) {
  const [status, setStatus] = useState<IntegrationStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [devAuth, setDevAuth] = useState(false);

  const refresh = useCallback(() => api.integrations().then(setStatus).catch(() => setError("לא הצלחנו לטעון את החיבורים")), []);

  useEffect(() => {
    void refresh();
    void loadConfig().then((c) => setDevAuth(!!c.devAuth));
  }, [refresh]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      location.href = await api.googleStart();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    await api.googleDisconnect();
    await refresh();
    setBusy(false);
  }

  const google = status?.google;

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>חיבורים</h1>
          <p className="muted">העוזר יכול לעבוד בשבילכם רק עם מה שחיברתם.</p>
        </div>
      </header>

      {notice && <p className={`notice ${notice.startsWith("✓") ? "ok" : ""}`}>{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="card integration">
        <DriveIcon />
        <div className="grow">
          <h3>Google Drive</h3>
          <p className="muted">
            {google?.connected
              ? `מחובר${google.email ? ` (${google.email})` : ""}. העוזר יכול לחפש, לקרוא וליצור מסמכים.`
              : "חיפוש וקריאה של מסמכים, ויצירת מסמכים חדשים כמו רשימות ותוכניות."}
          </p>
          {google && !google.configured && (
            <p className="hint">החיבור עוד לא הוגדר בשרת. ההוראות ב-README, בפרק "חיבור Google".</p>
          )}
        </div>
        {google?.connected ? (
          <button onClick={disconnect} disabled={busy}>
            ניתוק
          </button>
        ) : (
          <button className="primary" onClick={connect} disabled={busy || !google?.configured}>
            חיבור
          </button>
        )}
      </div>

      {[
        ["יומן Google", "לראות ולקבוע אירועים משותפים"],
        ["Gmail", "לזהות חשבונות ותשלומים שצריך לטפל בהם"],
        ["WhatsApp", "תזכורות ועדכונים ישירות לטלפון"],
      ].map(([name, desc]) => (
        <div className="card integration soon" key={name}>
          <div className="soon-dot" />
          <div className="grow">
            <h3>{name}</h3>
            <p className="muted">{desc}</p>
          </div>
          <span className="tag">בקרוב</span>
        </div>
      ))}

      <div className="card">
        <h3>החשבון שלי</h3>
        <p className="muted">
          {me.name}
          {me.members.length > 1 && ` · בבית: ${me.members.map((m) => m.name).join(" ו")}`}
        </p>
        {!devAuth && (
          <button
            onClick={() => {
              logout();
              onLogout();
            }}
          >
            התנתקות
          </button>
        )}
      </div>
    </section>
  );
}

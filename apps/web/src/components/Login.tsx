import { useState, type FormEvent } from "react";
import { NewPasswordRequired, login, setNewPassword } from "../auth";

const errorText: Record<string, string> = {
  NotAuthorizedException: "אימייל או סיסמה שגויים",
  UserNotFoundException: "אימייל או סיסמה שגויים",
  InvalidPasswordException: "הסיסמה חלשה מדי (לפחות 8 תווים, אות גדולה, קטנה ומספר)",
  TooManyRequestsException: "יותר מדי ניסיונות, נסו שוב בעוד רגע",
};

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<NewPasswordRequired>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challenge) await setNewPassword(challenge, password);
      else await login(email.trim(), password);
      onDone();
    } catch (err) {
      if (err instanceof NewPasswordRequired) {
        setChallenge(err);
        setPassword("");
      } else {
        const key = err instanceof Error ? err.message : "";
        setError(errorText[key] ?? "משהו השתבש, נסו שוב");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <img src="/icon.svg" alt="" width="72" height="72" />
        <h1>יחד</h1>
        <p className="muted">{challenge ? "בחרו סיסמה חדשה כדי להמשיך" : "ניהול החיים שלנו, במקום אחד"}</p>
        <form onSubmit={submit}>
          {!challenge && (
            <input
              type="email"
              dir="ltr"
              placeholder="אימייל"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
          <input
            type="password"
            dir="ltr"
            placeholder={challenge ? "סיסמה חדשה" : "סיסמה"}
            autoComplete={challenge ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "רגע..." : challenge ? "שמירה והמשך" : "כניסה"}
          </button>
        </form>
      </div>
    </main>
  );
}

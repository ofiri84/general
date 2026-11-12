import { loadConfig } from "./config";

interface Session {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

const KEY = "yachad.session";

export class NewPasswordRequired extends Error {
  constructor(
    public session: string,
    public username: string,
  ) {
    super("NEW_PASSWORD_REQUIRED");
  }
}

async function cognito(target: string, body: unknown) {
  const cfg = await loadConfig();
  if (!cfg.cognito) throw new Error("Auth is not configured");
  const res = await fetch(`https://cognito-idp.${cfg.cognito.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify({ ClientId: cfg.cognito.clientId, ...(body as object) }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.__type ?? "AuthError");
  return json;
}

function save(auth: { IdToken: string; RefreshToken?: string; ExpiresIn: number }, previousRefresh?: string) {
  const session: Session = {
    idToken: auth.IdToken,
    refreshToken: auth.RefreshToken ?? previousRefresh ?? "",
    expiresAt: Date.now() + auth.ExpiresIn * 1000,
  };
  localStorage.setItem(KEY, JSON.stringify(session));
}

function load(): Session | undefined {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "") as Session;
  } catch {
    return undefined;
  }
}

export async function login(username: string, password: string) {
  const res = await cognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: username, PASSWORD: password },
  });
  if (res.ChallengeName === "NEW_PASSWORD_REQUIRED") throw new NewPasswordRequired(res.Session, username);
  save(res.AuthenticationResult);
}

export async function setNewPassword(challenge: NewPasswordRequired, newPassword: string) {
  const res = await cognito("RespondToAuthChallenge", {
    ChallengeName: "NEW_PASSWORD_REQUIRED",
    Session: challenge.session,
    ChallengeResponses: { USERNAME: challenge.username, NEW_PASSWORD: newPassword },
  });
  save(res.AuthenticationResult);
}

export function logout() {
  localStorage.removeItem(KEY);
}

export function devUser() {
  const param = new URLSearchParams(location.search).get("as");
  if (param) localStorage.setItem("yachad.devUser", param);
  const who = localStorage.getItem("yachad.devUser") ?? "me";
  return who === "wife" ? "dev-wife:נועה" : "dev-me:אורי";
}

/** Returns a valid ID token, refreshing it when it is about to expire. Undefined when signed out. */
export async function getToken(): Promise<string | undefined> {
  const cfg = await loadConfig();
  if (cfg.devAuth) return `dev:${devUser().split(":")[0]}:${encodeURIComponent(devUser().split(":")[1]!)}`;
  const session = load();
  if (!session) return undefined;
  if (session.expiresAt - 60_000 > Date.now()) return session.idToken;
  try {
    const res = await cognito("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    save(res.AuthenticationResult, session.refreshToken);
    return res.AuthenticationResult.IdToken as string;
  } catch {
    logout();
    return undefined;
  }
}

export async function isSignedIn() {
  return !!(await getToken());
}

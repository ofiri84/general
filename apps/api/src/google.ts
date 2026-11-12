import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { GoogleTokens, Store } from "./store.js";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

const MAX_READ_CHARS = 20_000;

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google account is not connected");
  }
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

export async function signState(config: Config, payload: { userId: string; redirectUri: string }) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 }));
  const sig = createHmac("sha256", await config.getStateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export async function verifyState(config: Config, state: string): Promise<{ userId: string; redirectUri: string } | undefined> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return undefined;
  const expected = createHmac("sha256", await config.getStateKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      userId: string;
      redirectUri: string;
      exp: number;
    };
    if (parsed.exp < Date.now()) return undefined;
    return { userId: parsed.userId, redirectUri: parsed.redirectUri };
  } catch {
    return undefined;
  }
}

/** Only our own deployed origin or localhost may receive the OAuth callback. */
export function isAllowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    return u.pathname === "/api/integrations/google/callback" && (u.protocol === "https:" || u.hostname === "localhost");
  } catch {
    return false;
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export class GoogleClient {
  constructor(
    private config: Config,
    private store: Store,
    private userId: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async isConfigured() {
    return !!(await this.config.getGoogleCreds());
  }

  async authUrl(redirectUri: string) {
    const creds = await this.config.getGoogleCreds();
    if (!creds) throw new Error("Google integration is not configured");
    const state = await signState(this.config, { userId: this.userId, redirectUri });
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async completeAuth(code: string, redirectUri: string) {
    const creds = await this.config.getGoogleCreds();
    if (!creds) throw new Error("Google integration is not configured");
    const res = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
    const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
    const previous = await this.store.getGoogleTokens(this.userId);
    const refreshToken = json.refresh_token ?? previous?.refreshToken;
    if (!refreshToken) throw new Error("Google did not return a refresh token");
    let email: string | undefined;
    if (json.id_token) {
      try {
        const claims = JSON.parse(Buffer.from(json.id_token.split(".")[1] ?? "", "base64url").toString());
        email = claims.email;
      } catch {
        /* optional */
      }
    }
    await this.store.putGoogleTokens(this.userId, {
      refreshToken,
      accessToken: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      email,
    });
  }

  async status() {
    const tokens = await this.store.getGoogleTokens(this.userId);
    return { connected: !!tokens, email: tokens?.email };
  }

  async disconnect() {
    await this.store.deleteGoogleTokens(this.userId);
  }

  private async accessToken(): Promise<string> {
    const tokens = await this.store.getGoogleTokens(this.userId);
    if (!tokens) throw new GoogleNotConnectedError();
    if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
    const creds = await this.config.getGoogleCreds();
    if (!creds) throw new Error("Google integration is not configured");
    const res = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) await this.store.deleteGoogleTokens(this.userId);
      throw new GoogleNotConnectedError();
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    await this.store.putGoogleTokens(this.userId, {
      ...tokens,
      accessToken: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    });
    return json.access_token;
  }

  private async api(url: string, init: RequestInit = {}) {
    const token = await this.accessToken();
    const res = await this.fetchFn(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Google API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  async searchFiles(query: string): Promise<DriveFile[]> {
    const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`;
    const params = new URLSearchParams({
      q,
      pageSize: "10",
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    });
    const res = await this.api(`https://www.googleapis.com/drive/v3/files?${params}`);
    return ((await res.json()) as { files: DriveFile[] }).files;
  }

  async readFile(fileId: string): Promise<{ name: string; text: string; truncated: boolean }> {
    const id = encodeURIComponent(fileId);
    const metaRes = await this.api(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size`);
    const meta = (await metaRes.json()) as { name: string; mimeType: string; size?: string };
    let res: Response;
    if (meta.mimeType === "application/vnd.google-apps.document" || meta.mimeType === "application/vnd.google-apps.presentation") {
      res = await this.api(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`);
    } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
      res = await this.api(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv`);
    } else if (meta.mimeType.startsWith("text/") || meta.mimeType === "application/json") {
      res = await this.api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    } else {
      return { name: meta.name, text: `(לא ניתן לקרוא קבצים מסוג ${meta.mimeType} ישירות)`, truncated: false };
    }
    const text = await res.text();
    return { name: meta.name, text: text.slice(0, MAX_READ_CHARS), truncated: text.length > MAX_READ_CHARS };
  }

  async createDoc(title: string, content: string): Promise<DriveFile> {
    const boundary = `yachad${Date.now()}`;
    const metadata = JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.api(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink",
      { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body },
    );
    return (await res.json()) as DriveFile;
  }
}

export type { GoogleTokens };

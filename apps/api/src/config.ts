import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  getGoogleCreds(): Promise<GoogleCreds | undefined>;
  getStateKey(): Promise<string>;
}

export class StaticConfig implements Config {
  constructor(
    private google: GoogleCreds | undefined,
    private stateKey = "dev-state-key",
  ) {}
  async getGoogleCreds() {
    return this.google;
  }
  async getStateKey() {
    return this.stateKey;
  }
}

/** Reads secrets from AWS Secrets Manager and caches them for the life of the Lambda container. */
export class SecretsConfig implements Config {
  private cache = new Map<string, { value: string; at: number }>();
  constructor(
    private googleSecretId: string,
    private stateKeySecretId: string,
    private client = new SecretsManagerClient({}),
  ) {}

  private async secret(id: string) {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
    const res = await this.client.send(new GetSecretValueCommand({ SecretId: id }));
    const value = res.SecretString ?? "";
    this.cache.set(id, { value, at: Date.now() });
    return value;
  }

  async getGoogleCreds() {
    try {
      const parsed = JSON.parse(await this.secret(this.googleSecretId)) as Partial<GoogleCreds>;
      if (parsed.clientId && parsed.clientSecret) return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
    } catch {
      /* not configured yet */
    }
    return undefined;
  }

  async getStateKey() {
    return this.secret(this.stateKeySecretId);
  }
}

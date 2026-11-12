import type { AppConfig } from "@yachad/shared";

let cached: AppConfig | undefined;

/** In production `config.json` is written next to the site by the CDK deployment. */
export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  if (import.meta.env.DEV) {
    cached = { devAuth: true };
    return cached;
  }
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("config.json missing");
  cached = (await res.json()) as AppConfig;
  return cached;
}

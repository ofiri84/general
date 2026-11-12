import { createServer } from "node:http";
import { StaticConfig } from "./config.js";
import { FakeLlm } from "./fake-llm.js";
import { BedrockLlm } from "./llm.js";
import { handle } from "./router.js";
import { MemoryStore } from "./store.js";
import { createTask } from "./tasks.js";

const port = Number(process.env.PORT ?? 8787);
const store = new MemoryStore();
const llm = process.env.USE_BEDROCK
  ? new BedrockLlm(process.env.MODEL_ID ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
  : new FakeLlm();
const config = new StaticConfig(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
    : undefined,
);

async function seed() {
  await store.upsertMember({ id: "dev-me", name: "אורי" });
  await store.upsertMember({ id: "dev-wife", name: "נועה" });
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86400_000);
    return d.toISOString().slice(0, 10);
  };
  await createTask(store, "dev-me", { title: "לשלם ארנונה", dueDate: day(-1), category: "כספים", assignee: "dev-me" });
  await createTask(store, "dev-wife", { title: "קניות לשבת", dueDate: day(0), category: "קניות", assignee: "both" });
  await createTask(store, "dev-me", { title: "לקבוע תור לרופא שיניים", dueDate: day(2), category: "בריאות", assignee: "dev-wife" });
  await createTask(store, "dev-wife", { title: "להזמין מתנה ליום הולדת של אמא", dueDate: day(6), category: "משפחה" });
  await createTask(store, "dev-me", { title: "להחליף נורה במסדרון", category: "בית", assignee: "dev-me" });
}

/** Dev auth: "Authorization: Bearer dev:<id>:<name>". Never available in the Lambda build. */
function devClaims(header: string | undefined) {
  const m = header?.match(/^Bearer dev:([^:]+):(.+)$/);
  return m ? { sub: m[1]!, name: decodeURIComponent(m[2]!) } : undefined;
}

await seed();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const out = await handle(
    {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
      body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined,
      claims: devClaims(req.headers.authorization),
    },
    { store, config, llm },
  );
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}).listen(port, () => {
  console.log(`yachad api (local) on http://localhost:${port}  llm=${process.env.USE_BEDROCK ? "bedrock" : "fake"}`);
});

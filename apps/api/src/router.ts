import type { ChatMessage, ChatReply, IntegrationStatus, Me, Member } from "@yachad/shared";
import { z } from "zod";
import { runAgent } from "./agent.js";
import type { Config } from "./config.js";
import { GoogleClient, isAllowedRedirect, verifyState } from "./google.js";
import type { Llm } from "./llm.js";
import type { Store } from "./store.js";
import { createTask, createTaskSchema, newId, sortTasks, updateTask, updateTaskSchema } from "./tasks.js";

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body?: string;
  claims?: Record<string, unknown>;
}

export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface Deps {
  store: Store;
  config: Config;
  llm: Llm;
  fetchFn?: typeof fetch;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (status: number, data: unknown): ApiResponse => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(data),
});

const redirect = (location: string): ApiResponse => ({ status: 302, headers: { location, "cache-control": "no-store" } });

function parseBody<T>(schema: z.ZodType<T>, body: string | undefined): T {
  let raw: unknown;
  try {
    raw = body ? JSON.parse(body) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

function memberFromClaims(claims: Record<string, unknown>): Member {
  const id = String(claims.sub ?? "");
  const email = typeof claims.email === "string" ? claims.email : "";
  const name =
    (typeof claims.name === "string" && claims.name.trim()) || (email ? email.split("@")[0]! : "") || "משתמש";
  return { id, name };
}

const knownMembers = new Map<string, string>();

async function ensureMember(store: Store, member: Member) {
  if (knownMembers.get(member.id) === member.name) return;
  await store.upsertMember(member);
  knownMembers.set(member.id, member.name);
}

export async function handle(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  try {
    return await route(req, deps);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error("Unhandled error", err);
    return json(500, { error: "Internal error" });
  }
}

async function route(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  const { store, config } = deps;
  const method = req.method.toUpperCase();
  const path = req.path.replace(/\/+$/, "") || "/";

  if (method === "GET" && path === "/api/health") return json(200, { ok: true });

  if (method === "GET" && path === "/api/integrations/google/callback") {
    const state = req.query.state ? await verifyState(config, req.query.state) : undefined;
    if (!state || !isAllowedRedirect(state.redirectUri)) throw new HttpError(400, "Invalid state");
    const origin = new URL(state.redirectUri).origin;
    if (req.query.error || !req.query.code) return redirect(`${origin}/?google=denied`);
    try {
      await new GoogleClient(config, store, state.userId, deps.fetchFn).completeAuth(req.query.code, state.redirectUri);
    } catch (err) {
      console.error("Google auth failed", err);
      return redirect(`${origin}/?google=error`);
    }
    return redirect(`${origin}/?google=connected`);
  }

  const sub = req.claims?.sub;
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Unauthorized");
  const me = memberFromClaims(req.claims!);
  await ensureMember(store, me);
  const google = new GoogleClient(config, store, me.id, deps.fetchFn);

  if (method === "GET" && path === "/api/me") {
    const members = await store.listMembers();
    const body: Me = { ...me, members: members.length ? members : [me] };
    return json(200, body);
  }

  if (path === "/api/tasks") {
    if (method === "GET") return json(200, { tasks: sortTasks(await store.listTasks()) });
    if (method === "POST") {
      const input = parseBody(createTaskSchema, req.body);
      return json(201, { task: await createTask(store, me.id, input) });
    }
  }

  const taskMatch = path.match(/^\/api\/tasks\/([\w-]+)$/);
  if (taskMatch) {
    const id = taskMatch[1]!;
    if (method === "PATCH") {
      const task = await updateTask(store, id, parseBody(updateTaskSchema, req.body));
      if (!task) throw new HttpError(404, "Task not found");
      return json(200, { task });
    }
    if (method === "DELETE") {
      await store.deleteTask(id);
      return json(200, { ok: true });
    }
  }

  if (path === "/api/chat") {
    if (method === "GET") return json(200, { messages: await store.listMessages(me.id, 50) });
    if (method === "POST") {
      const { message } = parseBody(z.object({ message: z.string().trim().min(1).max(2000) }), req.body);
      const history = await store.listMessages(me.id, 16);
      const userMessage: ChatMessage = { id: newId(), role: "user", text: message, createdAt: new Date().toISOString() };
      await store.addMessage(me.id, userMessage);
      let result;
      try {
        result = await runAgent({ llm: deps.llm, store, google, user: me }, message, history);
      } catch (err) {
        console.error("Agent failed", err);
        result = { text: "משהו השתבש אצלי, אפשר לנסות שוב בעוד רגע?", actions: [], tasksChanged: false };
      }
      const reply: ChatMessage = {
        id: newId(),
        role: "assistant",
        text: result.text,
        createdAt: new Date(Date.now() + 1).toISOString(),
        actions: result.actions.length ? result.actions : undefined,
      };
      await store.addMessage(me.id, reply);
      const body: ChatReply = { reply, userMessage, tasksChanged: result.tasksChanged };
      return json(200, body);
    }
  }

  if (method === "GET" && path === "/api/integrations") {
    const status = await google.status();
    const body: IntegrationStatus = { google: { configured: await google.isConfigured(), ...status } };
    return json(200, body);
  }

  if (method === "POST" && path === "/api/integrations/google/start") {
    const { origin } = parseBody(z.object({ origin: z.string().url() }), req.body);
    const redirectUri = `${origin.replace(/\/$/, "")}/api/integrations/google/callback`;
    if (!isAllowedRedirect(redirectUri)) throw new HttpError(400, "Invalid origin");
    if (!(await google.isConfigured())) throw new HttpError(409, "Google integration is not configured yet");
    return json(200, { url: await google.authUrl(redirectUri) });
  }

  if (method === "DELETE" && path === "/api/integrations/google") {
    await google.disconnect();
    return json(200, { ok: true });
  }

  throw new HttpError(404, "Not found");
}

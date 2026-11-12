import { describe, expect, it } from "vitest";
import { StaticConfig } from "../src/config.js";
import { FakeLlm } from "../src/fake-llm.js";
import { handle, type ApiRequest } from "../src/router.js";
import { MemoryStore } from "../src/store.js";
import { verifyState, signState } from "../src/google.js";

function setup() {
  const store = new MemoryStore();
  const config = new StaticConfig({ clientId: "cid", clientSecret: "sec" }, "k");
  const deps = { store, config, llm: new FakeLlm() };
  const call = (req: Partial<ApiRequest> & { method: string; path: string }, user?: { sub: string; name: string }) =>
    handle({ query: {}, headers: {}, claims: user, ...req }, deps).then((r) => ({
      ...r,
      json: r.body ? JSON.parse(r.body) : undefined,
    }));
  return { store, config, call };
}

const u1 = { sub: "u1", name: "אורי" };
const u2 = { sub: "u2", name: "נועה" };

describe("router", () => {
  it("requires auth except health", async () => {
    const { call } = setup();
    expect((await call({ method: "GET", path: "/api/health" })).status).toBe(200);
    expect((await call({ method: "GET", path: "/api/tasks" })).status).toBe(401);
  });

  it("shares tasks between members and lists both members in /me", async () => {
    const { call } = setup();
    await call({ method: "GET", path: "/api/me" }, u1);
    const me2 = await call({ method: "GET", path: "/api/me" }, u2);
    expect(me2.json.members.map((m: { name: string }) => m.name).sort()).toEqual(["אורי", "נועה"]);

    const created = await call(
      { method: "POST", path: "/api/tasks", body: JSON.stringify({ title: "קניות", dueDate: "2026-11-20", assignee: "both" }) },
      u1,
    );
    expect(created.status).toBe(201);
    const list = await call({ method: "GET", path: "/api/tasks" }, u2);
    expect(list.json.tasks).toHaveLength(1);

    const id = created.json.task.id;
    const done = await call({ method: "PATCH", path: `/api/tasks/${id}`, body: JSON.stringify({ status: "done" }) }, u2);
    expect(done.json.task.status).toBe("done");
    expect(done.json.task.completedAt).toBeTruthy();

    const reopened = await call({ method: "PATCH", path: `/api/tasks/${id}`, body: JSON.stringify({ status: "open", dueDate: null }) }, u1);
    expect(reopened.json.task.completedAt).toBeUndefined();
    expect(reopened.json.task.dueDate).toBeUndefined();

    expect((await call({ method: "DELETE", path: `/api/tasks/${id}` }, u1)).status).toBe(200);
    expect((await call({ method: "PATCH", path: `/api/tasks/${id}`, body: "{}" }, u1)).status).toBe(404);
  });

  it("validates input", async () => {
    const { call } = setup();
    expect((await call({ method: "POST", path: "/api/tasks", body: JSON.stringify({ title: "" }) }, u1)).status).toBe(400);
    expect(
      (await call({ method: "POST", path: "/api/tasks", body: JSON.stringify({ title: "x", dueDate: "tomorrow" }) }, u1)).status,
    ).toBe(400);
    expect((await call({ method: "POST", path: "/api/tasks", body: "{not json" }, u1)).status).toBe(400);
  });

  it("chat runs the agent, persists history per user and flags task changes", async () => {
    const { call } = setup();
    const res = await call({ method: "POST", path: "/api/chat", body: JSON.stringify({ message: "תוסיף לקנות חלב" }) }, u1);
    expect(res.status).toBe(200);
    expect(res.json.tasksChanged).toBe(true);
    expect(res.json.reply.actions[0].type).toBe("task_added");
    const history1 = await call({ method: "GET", path: "/api/chat" }, u1);
    expect(history1.json.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    const history2 = await call({ method: "GET", path: "/api/chat" }, u2);
    expect(history2.json.messages).toHaveLength(0);
    expect((await call({ method: "GET", path: "/api/tasks" }, u2)).json.tasks[0].title).toBe("לקנות חלב");
  });

  it("google start returns a consent URL and rejects foreign callbacks", async () => {
    const { call, config } = setup();
    const start = await call(
      { method: "POST", path: "/api/integrations/google/start", body: JSON.stringify({ origin: "https://yachad.example" }) },
      u1,
    );
    expect(start.status).toBe(200);
    const url = new URL(start.json.url);
    expect(url.searchParams.get("redirect_uri")).toBe("https://yachad.example/api/integrations/google/callback");
    expect(url.searchParams.get("scope")).toContain("drive.readonly");
    const state = url.searchParams.get("state")!;
    expect(await verifyState(config, state)).toMatchObject({ userId: "u1" });
    expect(await verifyState(config, state + "x")).toBeUndefined();

    const http = await call(
      { method: "POST", path: "/api/integrations/google/start", body: JSON.stringify({ origin: "http://evil.example" }) },
      u1,
    );
    expect(http.status).toBe(400);

    expect((await call({ method: "GET", path: "/api/integrations/google/callback", query: { state: "bad", code: "c" } })).status).toBe(400);
    const evilState = await signState(config, { userId: "u1", redirectUri: "https://evil.example/steal" });
    expect((await call({ method: "GET", path: "/api/integrations/google/callback", query: { state: evilState, code: "c" } })).status).toBe(400);
    const denied = await call({
      method: "GET",
      path: "/api/integrations/google/callback",
      query: { state: await signState(config, { userId: "u1", redirectUri: "https://yachad.example/api/integrations/google/callback" }), error: "access_denied" },
    });
    expect(denied.status).toBe(302);
    expect(denied.headers?.location).toBe("https://yachad.example/?google=denied");
  });
});

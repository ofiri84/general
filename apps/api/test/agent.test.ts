import { describe, expect, it } from "vitest";
import { runAgent } from "../src/agent.js";
import { StaticConfig } from "../src/config.js";
import { GoogleClient } from "../src/google.js";
import type { Llm, LlmMessage, LlmResponse } from "../src/llm.js";
import { MemoryStore } from "../src/store.js";

const me = { id: "u1", name: "אורי" };
const wife = { id: "u2", name: "נועה" };

function scripted(responses: LlmResponse[]) {
  const calls: { system: string; messages: LlmMessage[] }[] = [];
  const llm: Llm = {
    async converse(args) {
      calls.push({ system: args.system, messages: JSON.parse(JSON.stringify(args.messages)) });
      const next = responses.shift();
      if (!next) throw new Error("no more scripted responses");
      return next;
    },
  };
  return { llm, calls };
}

async function setup(responses: LlmResponse[], fetchFn?: typeof fetch) {
  const store = new MemoryStore();
  await store.upsertMember(me);
  await store.upsertMember(wife);
  const config = new StaticConfig({ clientId: "cid", clientSecret: "secret" });
  const { llm, calls } = scripted(responses);
  const google = new GoogleClient(config, store, me.id, fetchFn);
  return { store, llm, calls, ctx: { llm, store, google, user: me, now: new Date("2026-11-12T10:00:00Z") } };
}

describe("agent", () => {
  it("adds a task for the partner via tool use and reports the action", async () => {
    const { ctx, store, calls } = await setup([
      {
        stopReason: "tool_use",
        content: [
          {
            toolUse: {
              toolUseId: "a",
              name: "add_task",
              input: { title: "לקנות חלב", assignee: "partner", dueDate: "2026-11-13", category: "קניות" },
            },
          },
        ],
      },
      { stopReason: "end_turn", content: [{ text: "הוספתי לנועה." }] },
    ]);

    const result = await runAgent(ctx, "תוסיף לאשתי לקנות חלב מחר", []);

    expect(result.text).toBe("הוספתי לנועה.");
    expect(result.tasksChanged).toBe(true);
    expect(result.actions[0]?.label).toContain("לקנות חלב");
    const tasks = await store.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "לקנות חלב", assignee: "u2", dueDate: "2026-11-13", createdBy: "u1" });
    expect(calls[0]!.system).toContain("2026-11-12");
    expect(calls[0]!.system).toContain("נועה");
    const toolResultMsg = calls[1]!.messages.at(-1)!;
    expect(toolResultMsg.role).toBe("user");
    expect(JSON.stringify(toolResultMsg.content)).toContain("toolResult");
  });

  it("completes and deletes tasks, and tolerates unknown ids", async () => {
    const { ctx, store } = await setup([
      {
        stopReason: "tool_use",
        content: [
          { toolUse: { toolUseId: "1", name: "complete_task", input: { id: "nope" } } },
          { toolUse: { toolUseId: "2", name: "add_task", input: { title: "x" } } },
        ],
      },
      { stopReason: "end_turn", content: [{ text: "ok" }] },
    ]);
    const result = await runAgent(ctx, "hi", []);
    expect(result.text).toBe("ok");
    expect(await store.listTasks()).toHaveLength(1);
  });

  it("returns tool errors to the model instead of throwing (Google not connected)", async () => {
    const { ctx, calls } = await setup([
      { stopReason: "tool_use", content: [{ toolUse: { toolUseId: "1", name: "drive_search", input: { query: "ביטוח" } } }] },
      { stopReason: "end_turn", content: [{ text: "צריך לחבר את גוגל." }] },
    ]);
    const result = await runAgent(ctx, "חפש בדרייב ביטוח", []);
    expect(result.text).toBe("צריך לחבר את גוגל.");
    const last = JSON.stringify(calls[1]!.messages.at(-1));
    expect(last).toContain("not connected");
    expect(last).toContain('"status":"error"');
  });

  it("searches and reads Google Drive with a refreshed token", async () => {
    const requests: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      requests.push(u);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }));
      }
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer fresh");
      if (u.includes("/export")) return new Response("תוכן המסמך");
      if (u.includes("fields=id,name,mimeType,size")) {
        return new Response(JSON.stringify({ name: "ביטוח", mimeType: "application/vnd.google-apps.document" }));
      }
      return new Response(JSON.stringify({ files: [{ id: "f1", name: "ביטוח רכב", mimeType: "x" }] }));
    }) as typeof fetch;
    const { ctx, store } = await setup(
      [
        { stopReason: "tool_use", content: [{ toolUse: { toolUseId: "1", name: "drive_search", input: { query: "ביטוח" } } }] },
        { stopReason: "tool_use", content: [{ toolUse: { toolUseId: "2", name: "drive_read_file", input: { fileId: "f1" } } }] },
        { stopReason: "end_turn", content: [{ text: "קראתי." }] },
      ],
      fetchFn,
    );
    await store.putGoogleTokens(me.id, { refreshToken: "r", expiresAt: 0 });
    const result = await runAgent(ctx, "מה כתוב בביטוח?", []);
    expect(result.actions.map((a) => a.type)).toEqual(["drive_search", "drive_read"]);
    expect(requests.filter((r) => r.includes("oauth2")).length).toBe(1);
    expect((await store.getGoogleTokens(me.id))?.accessToken).toBe("fresh");
  });

  it("keeps history alternating and starting with a user turn", async () => {
    const { ctx, calls } = await setup([{ stopReason: "end_turn", content: [{ text: "היי" }] }]);
    await runAgent(ctx, "שלום", [
      { id: "1", role: "assistant", text: "ישן", createdAt: "a" },
      { id: "2", role: "user", text: "שאלה", createdAt: "b" },
      { id: "3", role: "assistant", text: "תשובה", createdAt: "c" },
    ]);
    const roles = calls[0]!.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
  });

  it("stops after the step limit", async () => {
    const loop: LlmResponse = {
      stopReason: "tool_use",
      content: [{ toolUse: { toolUseId: "1", name: "list_tasks", input: {} } }],
    };
    const { ctx } = await setup(Array.from({ length: 10 }, () => loop));
    const result = await runAgent(ctx, "x", []);
    expect(result.text).toContain("רוצה שאמשיך");
  });
});

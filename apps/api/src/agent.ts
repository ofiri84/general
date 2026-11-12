import type { AgentAction, ChatMessage, Member, Task } from "@yachad/shared";
import { GoogleNotConnectedError, type GoogleClient } from "./google.js";
import type { Block, Llm, LlmMessage, ToolSpec } from "./llm.js";
import type { Store } from "./store.js";
import { createTask, createTaskSchema, resolveAssignee, sortTasks, updateTask, updateTaskSchema } from "./tasks.js";
import { z } from "zod";

const MAX_STEPS = 6;
const HISTORY_LIMIT = 16;
const TIMEZONE = "Asia/Jerusalem";

export interface AgentContext {
  llm: Llm;
  store: Store;
  google: GoogleClient;
  user: Member;
  now?: Date;
}

export interface AgentResult {
  text: string;
  actions: AgentAction[];
  tasksChanged: boolean;
}

export function todayInfo(now: Date) {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
  const weekday = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, weekday: "long" }).format(now);
  return { iso, weekday };
}

const tools: ToolSpec[] = [
  {
    name: "list_tasks",
    description: "List the household's tasks. Use to answer questions about what is open, due, or assigned to someone.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "done", "all"], description: "Default open" },
        assignee: { type: "string", description: "'me', 'partner', 'both' or a member name" },
        category: { type: "string" },
        dueBefore: { type: "string", description: "YYYY-MM-DD, inclusive" },
      },
    },
  },
  {
    name: "add_task",
    description: "Create a new task. Resolve relative dates (tomorrow, next Sunday) to YYYY-MM-DD using today's date.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, in Hebrew" },
        notes: { type: "string" },
        dueDate: { type: "string", description: "YYYY-MM-DD" },
        assignee: { type: "string", description: "'me', 'partner', 'both' or a member name" },
        category: { type: "string", description: "e.g. בית, קניות, משפחה, כספים, בריאות, עבודה" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Change fields of an existing task by id. Send null to clear dueDate/assignee/category/notes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        notes: { type: ["string", "null"] },
        dueDate: { type: ["string", "null"] },
        assignee: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as done (or reopen it with done=false).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, done: { type: "boolean", description: "Default true" } },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Permanently delete a task. Only when the user clearly asked to delete/remove it.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "drive_search",
    description: "Search the user's Google Drive by file name or content. Returns up to 10 files.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "drive_read_file",
    description: "Read the text of a Google Drive file (Docs, Sheets as CSV, text files) by id from drive_search.",
    inputSchema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] },
  },
  {
    name: "drive_create_doc",
    description: "Create a new Google Doc in the user's Drive with the given plain text (e.g. a checklist, summary, plan).",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" } },
      required: ["title", "content"],
    },
  },
];

function taskForModel(task: Task, members: Member[]) {
  const name = (id?: string) => (id === "both" ? "both" : members.find((m) => m.id === id)?.name ?? id);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.dueDate,
    assignee: name(task.assignee),
    category: task.category,
    notes: task.notes,
  };
}

export function buildSystemPrompt(args: { user: Member; members: Member[]; openTasks: Task[]; now: Date }) {
  const { iso, weekday } = todayInfo(args.now);
  const partner = args.members.filter((m) => m.id !== args.user.id);
  const snapshot = sortTasks(args.openTasks)
    .slice(0, 40)
    .map((t) => JSON.stringify(taskForModel(t, args.members)))
    .join("\n");
  return `You are "יחד" (Yachad), a warm, sharp personal assistant for a married couple managing their shared life: household chores, errands, family, money, health, work.

LANGUAGE AND STYLE
- Always answer in natural, concise Hebrew, unless the user writes in another language. Hebrew is right-to-left: do not mix in English words unless they are names.
- Replies are read on a phone and may be spoken aloud: short sentences, no markdown tables, no emoji spam, at most a short list when listing tasks.
- Be proactive but honest. Never claim you did something unless a tool call succeeded. If something is ambiguous (which task? which date?), ask one short question.

CONTEXT
- Today is ${weekday}, ${iso} (timezone ${TIMEZONE}). The week starts on Sunday. Resolve dates like "מחר" or "ביום שלישי הבא" to YYYY-MM-DD.
- You are talking to ${args.user.name} (id ${args.user.id}).${partner.length ? ` Their partner is ${partner.map((p) => p.name).join(", ")}.` : " Their partner has not signed in yet."}
- Assignee values: 'me' = ${args.user.name}, 'partner', 'both', or a member name.

HOW TO WORK
- You can act on your own with tools: manage tasks, and (when Google is connected) search/read/create Google Drive files. Do the work instead of just describing it. For multi-step requests, chain tools, then summarize what you did in one or two sentences.
- Before deleting anything, make sure the user explicitly asked.
- When the user shares a plan or a list ("we need to prepare for the holiday"), break it into concrete tasks and add them.
- If a Drive tool says Google is not connected, tell the user to connect it under "חיבורים".

OPEN TASKS RIGHT NOW (most urgent first, max 40):
${snapshot || "(none)"}`;
}

const listArgs = z.object({
  status: z.enum(["open", "done", "all"]).optional(),
  assignee: z.string().optional(),
  category: z.string().optional(),
  dueBefore: z.string().optional(),
});

interface ToolOutcome {
  result: Record<string, unknown>;
  action?: AgentAction;
  tasksChanged?: boolean;
}

async function runTool(ctx: AgentContext, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const { store, user, google } = ctx;
  const members = await store.listMembers();
  const known = members.some((m) => m.id === user.id) ? members : [...members, user];

  switch (name) {
    case "list_tasks": {
      const args = listArgs.parse(input);
      const status = args.status ?? "open";
      const assignee = args.assignee ? resolveAssignee(args.assignee, user, known) : undefined;
      let tasks = await store.listTasks();
      if (status !== "all") tasks = tasks.filter((t) => t.status === status);
      if (args.assignee) tasks = tasks.filter((t) => t.assignee === assignee);
      if (args.category) tasks = tasks.filter((t) => t.category === args.category);
      if (args.dueBefore) tasks = tasks.filter((t) => t.dueDate && t.dueDate <= args.dueBefore!);
      return { result: { tasks: sortTasks(tasks).slice(0, 60).map((t) => taskForModel(t, known)) } };
    }
    case "add_task": {
      const parsed = createTaskSchema.parse(input);
      const assignee = resolveAssignee(parsed.assignee, user, known);
      const task = await createTask(store, user.id, { ...parsed, assignee });
      return {
        result: { created: taskForModel(task, known) },
        action: { type: "task_added", label: `נוספה משימה: ${task.title}` },
        tasksChanged: true,
      };
    }
    case "update_task": {
      const { id, ...rest } = z.object({ id: z.string() }).passthrough().parse(input) as { id: string } & Record<string, unknown>;
      const patch = updateTaskSchema.parse(rest);
      if (typeof patch.assignee === "string") {
        const resolved = resolveAssignee(patch.assignee, user, known);
        patch.assignee = resolved ?? null;
      }
      const task = await updateTask(store, id, patch);
      if (!task) return { result: { error: "task not found" } };
      return {
        result: { updated: taskForModel(task, known) },
        action: { type: "task_updated", label: `עודכנה משימה: ${task.title}` },
        tasksChanged: true,
      };
    }
    case "complete_task": {
      const { id, done } = z.object({ id: z.string(), done: z.boolean().optional() }).parse(input);
      const task = await updateTask(store, id, { status: done === false ? "open" : "done" });
      if (!task) return { result: { error: "task not found" } };
      return {
        result: { updated: taskForModel(task, known) },
        action: { type: "task_completed", label: `${done === false ? "נפתחה מחדש" : "הושלמה"}: ${task.title}` },
        tasksChanged: true,
      };
    }
    case "delete_task": {
      const { id } = z.object({ id: z.string() }).parse(input);
      const task = await store.getTask(id);
      if (!task) return { result: { error: "task not found" } };
      await store.deleteTask(id);
      return {
        result: { deleted: task.title },
        action: { type: "task_deleted", label: `נמחקה משימה: ${task.title}` },
        tasksChanged: true,
      };
    }
    case "drive_search": {
      const { query } = z.object({ query: z.string().min(1) }).parse(input);
      const files = await google.searchFiles(query);
      return { result: { files }, action: { type: "drive_search", label: `חיפוש בדרייב: ${query}` } };
    }
    case "drive_read_file": {
      const { fileId } = z.object({ fileId: z.string() }).parse(input);
      const file = await google.readFile(fileId);
      return { result: file, action: { type: "drive_read", label: `נקרא קובץ: ${file.name}` } };
    }
    case "drive_create_doc": {
      const { title, content } = z.object({ title: z.string().min(1), content: z.string() }).parse(input);
      const file = await google.createDoc(title, content);
      return {
        result: { created: file },
        action: { type: "drive_created", label: `נוצר מסמך בדרייב: ${file.name}` },
      };
    }
    default:
      return { result: { error: `unknown tool ${name}` } };
  }
}

function textOf(blocks: Block[]) {
  return blocks
    .map((b) => ("text" in b ? b.text : ""))
    .join("")
    .trim();
}

export async function runAgent(ctx: AgentContext, userText: string, history: ChatMessage[]): Promise<AgentResult> {
  const now = ctx.now ?? new Date();
  const [members, tasks] = await Promise.all([ctx.store.listMembers(), ctx.store.listTasks()]);
  const system = buildSystemPrompt({
    user: ctx.user,
    members: members.some((m) => m.id === ctx.user.id) ? members : [...members, ctx.user],
    openTasks: tasks.filter((t) => t.status === "open"),
    now,
  });

  const messages: LlmMessage[] = history
    .filter((m) => m.text.trim())
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: [{ text: m.text }] }));
  while (messages[0]?.role === "assistant") messages.shift();
  const merged: LlmMessage[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content.push(...m.content);
    else merged.push({ role: m.role, content: [...m.content] });
  }
  const lastMerged = merged[merged.length - 1];
  if (lastMerged?.role === "user") lastMerged.content.push({ text: userText });
  else merged.push({ role: "user", content: [{ text: userText }] });

  const actions: AgentAction[] = [];
  let tasksChanged = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await ctx.llm.converse({ system, messages: merged, tools });
    merged.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((b): b is Extract<Block, { toolUse: unknown }> => "toolUse" in b);
    if (res.stopReason !== "tool_use" || calls.length === 0) {
      return { text: textOf(res.content) || "בוצע.", actions, tasksChanged };
    }
    const results: Block[] = [];
    for (const { toolUse } of calls) {
      try {
        const outcome = await runTool(ctx, toolUse.name, toolUse.input ?? {});
        if (outcome.action) actions.push(outcome.action);
        if (outcome.tasksChanged) tasksChanged = true;
        results.push({ toolResult: { toolUseId: toolUse.toolUseId, content: [{ json: outcome.result }] } });
      } catch (err) {
        const message =
          err instanceof GoogleNotConnectedError
            ? "Google is not connected. Ask the user to connect it under חיבורים."
            : err instanceof Error
              ? err.message
              : String(err);
        results.push({
          toolResult: { toolUseId: toolUse.toolUseId, content: [{ json: { error: message } }], status: "error" },
        });
      }
    }
    merged.push({ role: "user", content: results });
  }
  return { text: "ביצעתי מה שהצלחתי, אבל זה דורש עוד כמה צעדים. רוצה שאמשיך?", actions, tasksChanged };
}

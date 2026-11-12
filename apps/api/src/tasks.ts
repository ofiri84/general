import { randomBytes } from "node:crypto";
import type { Assignee, Member, Task } from "@yachad/shared";
import { z } from "zod";
import type { Store } from "./store.js";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD");

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).optional(),
  dueDate: dateString.optional(),
  assignee: z.string().max(100).optional(),
  category: z.string().trim().max(40).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  dueDate: dateString.nullable().optional(),
  assignee: z.string().max(100).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
  status: z.enum(["open", "done"]).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export function newId() {
  return randomBytes(5).toString("hex");
}

export async function createTask(store: Store, userId: string, input: CreateTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: newId(),
    title: input.title,
    notes: input.notes || undefined,
    status: "open",
    dueDate: input.dueDate,
    assignee: (input.assignee || undefined) as Assignee | undefined,
    category: input.category || undefined,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  await store.putTask(task);
  return task;
}

export async function updateTask(store: Store, id: string, patch: UpdateTaskInput): Promise<Task | undefined> {
  const existing = await store.getTask(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const next: Task = { ...existing, updatedAt: now };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.notes !== undefined) next.notes = patch.notes || undefined;
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate || undefined;
  if (patch.assignee !== undefined) next.assignee = (patch.assignee || undefined) as Assignee | undefined;
  if (patch.category !== undefined) next.category = patch.category || undefined;
  if (patch.status !== undefined && patch.status !== existing.status) {
    next.status = patch.status;
    next.completedAt = patch.status === "done" ? now : undefined;
  }
  await store.putTask(next);
  return next;
}

/** Turns "me" / "partner" / "both" / a member name into a stored assignee id. */
export function resolveAssignee(raw: string | undefined, me: Member, members: Member[]): Assignee | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (["both", "shared", "together", "שנינו", "משותף"].includes(lower)) return "both";
  if (["me", "myself", "אני", "שלי"].includes(lower)) return me.id;
  if (["partner", "spouse", "wife", "husband", "בן זוג", "בת זוג", "אשתי", "בעלי"].includes(lower)) {
    return members.find((m) => m.id !== me.id)?.id;
  }
  const byId = members.find((m) => m.id === value);
  if (byId) return byId.id;
  return members.find((m) => m.name.trim().toLowerCase() === lower)?.id;
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "done") return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate !== b.dueDate) return a.dueDate ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

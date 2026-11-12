import type { ChatMessage, ChatReply, IntegrationStatus, Me, Task } from "@yachad/shared";
import { getToken } from "./auth";

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new UnauthorizedError();
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export type TaskInput = Partial<{
  title: string;
  notes: string | null;
  dueDate: string | null;
  assignee: string | null;
  category: string | null;
  status: "open" | "done";
}>;

export const api = {
  me: () => request<Me>("/api/me"),
  tasks: () => request<{ tasks: Task[] }>("/api/tasks").then((r) => r.tasks),
  createTask: (input: TaskInput) =>
    request<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(input) }).then((r) => r.task),
  updateTask: (id: string, input: TaskInput) =>
    request<{ task: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((r) => r.task),
  deleteTask: (id: string) => request<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }),
  history: () => request<{ messages: ChatMessage[] }>("/api/chat").then((r) => r.messages),
  chat: (message: string) => request<ChatReply>("/api/chat", { method: "POST", body: JSON.stringify({ message }) }),
  integrations: () => request<IntegrationStatus>("/api/integrations"),
  googleStart: () =>
    request<{ url: string }>("/api/integrations/google/start", {
      method: "POST",
      body: JSON.stringify({ origin: location.origin }),
    }).then((r) => r.url),
  googleDisconnect: () => request<{ ok: true }>("/api/integrations/google", { method: "DELETE" }),
};

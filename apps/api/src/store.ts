import type { ChatMessage, Member, Task } from "@yachad/shared";

export interface GoogleTokens {
  refreshToken: string;
  accessToken?: string;
  /** epoch ms */
  expiresAt?: number;
  email?: string;
}

/** Storage boundary. Everything shares one household; chat and tokens are per user. */
export interface Store {
  upsertMember(member: Member): Promise<void>;
  listMembers(): Promise<Member[]>;
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  putTask(task: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;
  listMessages(userId: string, limit: number): Promise<ChatMessage[]>;
  addMessage(userId: string, message: ChatMessage): Promise<void>;
  getGoogleTokens(userId: string): Promise<GoogleTokens | undefined>;
  putGoogleTokens(userId: string, tokens: GoogleTokens): Promise<void>;
  deleteGoogleTokens(userId: string): Promise<void>;
}

export class MemoryStore implements Store {
  private members = new Map<string, Member>();
  private tasks = new Map<string, Task>();
  private messages = new Map<string, ChatMessage[]>();
  private google = new Map<string, GoogleTokens>();

  async upsertMember(member: Member) {
    this.members.set(member.id, member);
  }
  async listMembers() {
    return [...this.members.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  async listTasks() {
    return [...this.tasks.values()];
  }
  async getTask(id: string) {
    return this.tasks.get(id);
  }
  async putTask(task: Task) {
    this.tasks.set(task.id, task);
  }
  async deleteTask(id: string) {
    this.tasks.delete(id);
  }
  async listMessages(userId: string, limit: number) {
    return (this.messages.get(userId) ?? []).slice(-limit);
  }
  async addMessage(userId: string, message: ChatMessage) {
    const list = this.messages.get(userId) ?? [];
    list.push(message);
    this.messages.set(userId, list);
  }
  async getGoogleTokens(userId: string) {
    return this.google.get(userId);
  }
  async putGoogleTokens(userId: string, tokens: GoogleTokens) {
    this.google.set(userId, tokens);
  }
  async deleteGoogleTokens(userId: string) {
    this.google.delete(userId);
  }
}

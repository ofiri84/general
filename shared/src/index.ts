export type TaskStatus = "open" | "done";

/** "both" = shared task; otherwise a member id; undefined = unassigned. */
export type Assignee = string | "both";

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  /** YYYY-MM-DD */
  dueDate?: string;
  assignee?: Assignee;
  category?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface Member {
  id: string;
  name: string;
}

export interface AgentAction {
  type: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  actions?: AgentAction[];
}

export interface Me {
  id: string;
  name: string;
  members: Member[];
}

export interface IntegrationStatus {
  google: { configured: boolean; connected: boolean; email?: string };
}

export interface ChatReply {
  reply: ChatMessage;
  userMessage: ChatMessage;
  tasksChanged: boolean;
}

export interface AppConfig {
  cognito?: { region: string; clientId: string };
  /** Local development only: skip login and talk to the local API. */
  devAuth?: boolean;
}

export const DEFAULT_CATEGORIES = ["בית", "קניות", "משפחה", "כספים", "בריאות", "עבודה", "אחר"];

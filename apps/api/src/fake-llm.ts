import type { Block, Llm, LlmMessage, LlmResponse } from "./llm.js";

/** Tiny rule-based stand-in for Bedrock so the app can be run and demoed locally without AWS. */
export class FakeLlm implements Llm {
  async converse({ messages }: { messages: LlmMessage[] }): Promise<LlmResponse> {
    const last = messages[messages.length - 1]!;
    const results = last.content.filter((b): b is Extract<Block, { toolResult: unknown }> => "toolResult" in b);
    if (results.length) {
      const json = results[0]!.toolResult.content[0]?.json as Record<string, unknown>;
      if (Array.isArray(json.tasks)) {
        const tasks = json.tasks as { title: string }[];
        const text = tasks.length
          ? `יש ${tasks.length} משימות פתוחות: ${tasks.map((t) => t.title).join(", ")}.`
          : "אין משימות פתוחות, כל הכבוד!";
        return { content: [{ text }], stopReason: "end_turn" };
      }
      if (json.created) return { content: [{ text: "הוספתי. עוד משהו?" }], stopReason: "end_turn" };
      return { content: [{ text: "בוצע." }], stopReason: "end_turn" };
    }

    const text = last.content.map((b) => ("text" in b ? b.text : "")).join(" ").trim();
    if (/משימות|מה יש|מה פתוח/.test(text)) {
      return {
        content: [{ toolUse: { toolUseId: "t1", name: "list_tasks", input: {} } }],
        stopReason: "tool_use",
      };
    }
    if (/תוסיף|הוסף|תזכיר|צריך|לקנות/.test(text)) {
      const title = text.replace(/^(תוסיף|הוסף|תזכיר לי|תזכיר)\s*(לי)?\s*(משימה)?\s*/u, "").trim() || text;
      const assignee = /לאשתי|לבן זוג|לבת זוג/.test(text) ? "partner" : undefined;
      return {
        content: [{ toolUse: { toolUseId: "t1", name: "add_task", input: { title, assignee } } }],
        stopReason: "tool_use",
      };
    }
    return {
      content: [{ text: "אני כאן (מצב הדגמה מקומי, בלי מודל אמיתי). נסו: \"תוסיף לקנות חלב\" או \"מה המשימות שלנו?\"." }],
      stopReason: "end_turn",
    };
  }
}

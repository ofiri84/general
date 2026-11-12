import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ContentBlock, Message, ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";

export type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: { json: Record<string, unknown> }[]; status?: "success" | "error" } };

export interface LlmMessage {
  role: "user" | "assistant";
  content: Block[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmResponse {
  content: Block[];
  stopReason: string;
}

export interface Llm {
  converse(args: { system: string; messages: LlmMessage[]; tools: ToolSpec[] }): Promise<LlmResponse>;
}

export class BedrockLlm implements Llm {
  constructor(
    private modelId: string,
    private client = new BedrockRuntimeClient({}),
  ) {}

  async converse({ system, messages, tools }: { system: string; messages: LlmMessage[]; tools: ToolSpec[] }) {
    const toolConfig: ToolConfiguration = {
      tools: tools.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.inputSchema as never },
        },
      })),
    };
    const res = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: system }],
        messages: messages as unknown as Message[],
        toolConfig,
        inferenceConfig: { maxTokens: 1500, temperature: 0.3 },
      }),
    );
    const content = (res.output?.message?.content ?? []) as ContentBlock[];
    return {
      content: content.filter((b) => "text" in b || "toolUse" in b) as unknown as Block[],
      stopReason: res.stopReason ?? "end_turn",
    };
  }
}

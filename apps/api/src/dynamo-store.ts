import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ChatMessage, Member, Task } from "@yachad/shared";
import type { GoogleTokens, Store } from "./store.js";

const HOUSE = "HOUSE#home";
const MESSAGE_TTL_SECONDS = 90 * 24 * 3600;

export class DynamoStore implements Store {
  private db: DynamoDBDocumentClient;

  constructor(
    private table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private async queryAll(pk: string, skPrefix: string, opts: { limit?: number; reverse?: boolean } = {}) {
    const items: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: { ":pk": pk, ":sk": skPrefix },
          ScanIndexForward: !opts.reverse,
          Limit: opts.limit,
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...(res.Items ?? []));
      startKey = res.LastEvaluatedKey;
    } while (startKey && (!opts.limit || items.length < opts.limit));
    return opts.limit ? items.slice(0, opts.limit) : items;
  }

  async upsertMember(member: Member) {
    await this.db.send(
      new PutCommand({ TableName: this.table, Item: { pk: HOUSE, sk: `MEMBER#${member.id}`, ...member } }),
    );
  }

  async listMembers() {
    const items = await this.queryAll(HOUSE, "MEMBER#");
    return items.map((i) => ({ id: i.id as string, name: i.name as string }));
  }

  async listTasks() {
    const items = await this.queryAll(HOUSE, "TASK#");
    return items.map(({ pk: _pk, sk: _sk, ...task }) => task as unknown as Task);
  }

  async getTask(id: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: HOUSE, sk: `TASK#${id}` } }));
    if (!res.Item) return undefined;
    const { pk: _pk, sk: _sk, ...task } = res.Item;
    return task as unknown as Task;
  }

  async putTask(task: Task) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: HOUSE, sk: `TASK#${task.id}`, ...task } }));
  }

  async deleteTask(id: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: HOUSE, sk: `TASK#${id}` } }));
  }

  async listMessages(userId: string, limit: number) {
    const items = await this.queryAll(`USER#${userId}`, "MSG#", { limit, reverse: true });
    return items
      .reverse()
      .map(({ pk: _pk, sk: _sk, ttl: _ttl, ...m }) => m as unknown as ChatMessage);
  }

  async addMessage(userId: string, message: ChatMessage) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          pk: `USER#${userId}`,
          sk: `MSG#${message.createdAt}#${message.id}`,
          ttl: Math.floor(Date.now() / 1000) + MESSAGE_TTL_SECONDS,
          ...message,
        },
      }),
    );
  }

  async getGoogleTokens(userId: string) {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: `USER#${userId}`, sk: "GOOGLE" } }));
    if (!res.Item) return undefined;
    const { pk: _pk, sk: _sk, ...tokens } = res.Item;
    return tokens as unknown as GoogleTokens;
  }

  async putGoogleTokens(userId: string, tokens: GoogleTokens) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: `USER#${userId}`, sk: "GOOGLE", ...tokens } }));
  }

  async deleteGoogleTokens(userId: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: `USER#${userId}`, sk: "GOOGLE" } }));
  }
}

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { SecretsConfig } from "./config.js";
import { DynamoStore } from "./dynamo-store.js";
import { BedrockLlm } from "./llm.js";
import { handle, type Deps } from "./router.js";

let deps: Deps | undefined;

function getDeps(): Deps {
  if (!deps) {
    const env = (name: string) => {
      const v = process.env[name];
      if (!v) throw new Error(`Missing env var ${name}`);
      return v;
    };
    deps = {
      store: new DynamoStore(env("TABLE_NAME")),
      config: new SecretsConfig(env("GOOGLE_SECRET_ID"), env("STATE_KEY_SECRET_ID")),
      llm: new BedrockLlm(env("MODEL_ID")),
    };
  }
  return deps;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : undefined;
  const res = await handle(
    {
      method: event.requestContext.http.method,
      path: event.rawPath,
      query: event.queryStringParameters ?? {},
      headers: event.headers,
      body,
      claims: event.requestContext.authorizer?.jwt?.claims,
    },
    getDeps(),
  );
  return { statusCode: res.status, headers: res.headers, body: res.body };
}

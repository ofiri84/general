import * as cdk from "aws-cdk-lib";
import { YachadStack } from "../lib/yachad-stack.js";

const app = new cdk.App();

const domainName = app.node.tryGetContext("domainName") ?? process.env.DOMAIN_NAME;
const hostedZoneDomain = app.node.tryGetContext("hostedZoneDomain") ?? process.env.HOSTED_ZONE_DOMAIN;
const modelId = app.node.tryGetContext("modelId") ?? process.env.MODEL_ID;

new YachadStack(app, "Yachad", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // CloudFront certificates must live in us-east-1, so the whole stack does too.
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  domainName: domainName || undefined,
  hostedZoneDomain: hostedZoneDomain || undefined,
  modelId: modelId || undefined,
});

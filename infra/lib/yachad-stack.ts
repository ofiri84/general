import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

export interface YachadStackProps extends cdk.StackProps {
  /** e.g. "yachad.family". Omit to use the generated *.cloudfront.net address. */
  domainName?: string;
  /** Route 53 hosted zone that contains domainName. Defaults to domainName itself. */
  hostedZoneDomain?: string;
  /** Bedrock model or inference profile id. */
  modelId?: string;
}

export class YachadStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: YachadStackProps = {}) {
    super(scope, id, props);

    const modelId = props.modelId ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

    // ---------- Data ----------
    const table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const stateKey = new secrets.Secret(this, "StateKey", {
      description: "Signs the Google OAuth state parameter",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    const googleSecret = new secrets.Secret(this, "GoogleOAuth", {
      description: 'Google OAuth client. Edit the value to {"clientId":"...","clientSecret":"..."} (see README).',
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({ clientId: "", clientSecret: "" })),
    });

    // ---------- Auth ----------
    const userPool = new cognito.UserPool(this, "Users", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { fullname: { required: false, mutable: true } },
      passwordPolicy: { minLength: 8, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("Web", {
      authFlows: { userPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(365),
    });

    // ---------- Backend ----------
    const fn = new NodejsFunction(this, "Api", {
      entry: path.join(repoRoot, "apps/api/src/lambda.ts"),
      handler: "handler",
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(28),
      environment: {
        TABLE_NAME: table.tableName,
        GOOGLE_SECRET_ID: googleSecret.secretArn,
        STATE_KEY_SECRET_ID: stateKey.secretArn,
        MODEL_ID: modelId,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: { minify: true, sourceMap: true, target: "node22" },
      logGroup: new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY }),
    });
    table.grantReadWriteData(fn);
    googleSecret.grantRead(fn);
    stateKey.grantRead(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      }),
    );

    const httpApi = new apigw.HttpApi(this, "HttpApi", { createDefaultStage: false });
    new apigw.HttpStage(this, "Stage", {
      httpApi,
      stageName: "$default",
      autoDeploy: true,
      // Bedrock calls cost money: keep a runaway client from burning through them.
      throttle: { rateLimit: 20, burstLimit: 40 },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", fn);
    const authorizer = new HttpJwtAuthorizer("Jwt", `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });
    httpApi.addRoutes({ path: "/api/{proxy+}", methods: [apigw.HttpMethod.ANY], integration, authorizer });
    // Public routes: health check, and Google's redirect back to us (authenticated by the signed state).
    httpApi.addRoutes({ path: "/api/health", methods: [apigw.HttpMethod.GET], integration });
    httpApi.addRoutes({ path: "/api/integrations/google/callback", methods: [apigw.HttpMethod.GET], integration });

    // ---------- Frontend ----------
    const bucket = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        `function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}`,
      ),
    });

    let certificate: acm.ICertificate | undefined;
    let zone: route53.IHostedZone | undefined;
    if (props.domainName) {
      if (this.region !== "us-east-1") throw new Error("A custom domain requires deploying to us-east-1 (CloudFront certificate).");
      zone = route53.HostedZone.fromLookup(this, "Zone", { domainName: props.hostedZoneDomain ?? props.domainName });
      certificate = new acm.Certificate(this, "Cert", {
        domainName: props.domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }

    const apiOrigin = new origins.HttpOrigin(cdk.Fn.select(2, cdk.Fn.split("/", httpApi.apiEndpoint)), {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: props.domainName ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
      },
    });

    if (props.domainName && zone) {
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      new route53.ARecord(this, "Alias", { zone, recordName: props.domainName, target });
      new route53.AaaaRecord(this, "AliasV6", { zone, recordName: props.domainName, target });
    }

    const webDist = path.join(repoRoot, "apps/web/dist");
    const shellFiles = ["index.html", "config.json", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

    // Hashed build assets are immutable and can be cached for a year.
    const assets = new s3deploy.BucketDeployment(this, "DeployAssets", {
      destinationBucket: bucket,
      sources: [s3deploy.Source.asset(webDist)],
      exclude: shellFiles,
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString("public, max-age=31536000, immutable")],
    });

    // The app shell and runtime config must always be revalidated.
    const shell = new s3deploy.BucketDeployment(this, "DeployShell", {
      destinationBucket: bucket,
      sources: [
        s3deploy.Source.asset(webDist),
        s3deploy.Source.jsonData("config.json", {
          cognito: { region: this.region, clientId: userPoolClient.userPoolClientId },
        }),
      ],
      exclude: ["*"],
      include: shellFiles,
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString("no-cache")],
      distribution,
      distributionPaths: ["/index.html", "/config.json", "/manifest.webmanifest"],
    });
    shell.node.addDependency(assets);

    const siteUrl = props.domainName ? `https://${props.domainName}` : `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "SiteUrl", { value: siteUrl });
    new cdk.CfnOutput(this, "GoogleRedirectUri", {
      value: `${siteUrl}/api/integrations/google/callback`,
      description: "Add this as an Authorized redirect URI in the Google Cloud OAuth client",
    });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "GoogleSecretName", { value: googleSecret.secretName });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
  }
}

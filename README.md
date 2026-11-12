# יחד (Yachad) - our life, together

A Hebrew, mobile-first, installable web app (PWA) for two partners to manage everything they need to do, with an AI assistant (text + voice) that can act on its own.

- **Tasks**: shared list with due dates, owner (me / partner / both), categories, filters, live sync between both phones.
- **Assistant**: chat or tap the mic and talk in Hebrew. The agent calls tools to add, update, complete and delete tasks, and to search, read and create files in Google Drive. Replies can be read aloud.
- **Connections**: Google Drive today. Calendar, Gmail and WhatsApp are stubbed as "coming soon" (the agent tool framework is built for adding them).

## Architecture

```
Phone (PWA, React, RTL)
   |  https://<your-domain>
CloudFront ──/*──────────> S3 (static site, private, OAC)
    └──────/api/*───────> API Gateway (HTTP API, Cognito JWT) ──> Lambda (Node 22, arm64)
                                                                    ├─ DynamoDB (tasks, chat, tokens)
                                                                    ├─ Amazon Bedrock (Claude, tool use)
                                                                    ├─ Secrets Manager (Google OAuth client)
                                                                    └─ Google Drive API
```

One domain serves both the site and the API (`/api/*`), so there is no CORS. Everything is defined in AWS CDK (`infra/`), and the same code runs locally with an in-memory store.

| Path | What |
| --- | --- |
| `apps/web` | Vite + React + TypeScript client, Hebrew/RTL, Web Speech API for voice |
| `apps/api` | Lambda backend: router, agent loop, tools, DynamoDB store, Google client |
| `shared` | Types shared by client and server |
| `infra` | CDK stack, plus `github-oidc.yml` for keyless GitHub deploys |
| `scripts` | `create-user.sh`, icon generator |

## Run locally (no AWS needed)

```bash
npm install
npm run dev:api     # http://localhost:8787, in-memory data, fake rule-based "AI"
npm run dev:web     # http://localhost:5173, auto signed in as a dev user
```

Open `http://localhost:5173/?as=wife` to see the app as the second user. To use the real model locally, run the API with AWS credentials and `USE_BEDROCK=1`.

```bash
npm test            # API unit tests (agent loop, router, Google OAuth state)
npm run typecheck
```

## Deploy to AWS (one time, about 15 minutes)

Prerequisites: an AWS account, AWS CLI configured, Node 22.

1. **Enable the model.** In the Bedrock console (us-east-1), open *Model access* and make sure Anthropic Claude Sonnet 4.5 is available. Override with `-c modelId=...` / the `MODEL_ID` variable (for example Haiku for lower cost).
2. **Bootstrap CDK** (once per account/region):
   ```bash
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```
3. **Pick a domain** (see below), then deploy:
   ```bash
   npm install
   export DOMAIN_NAME=yachad.family            # optional, omit to use the *.cloudfront.net URL
   export HOSTED_ZONE_DOMAIN=yachad.family     # Route 53 hosted zone that contains it
   npm run deploy
   ```
   The stack outputs the site URL, user pool id and the Google redirect URI.
4. **Create the two accounts** (sign-up is disabled, only you two can enter):
   ```bash
   scripts/create-user.sh you@example.com "אורי" 'StrongPass1'
   scripts/create-user.sh wife@example.com "נועה" 'StrongPass2'
   ```
5. Open the site on both phones, sign in, and use *Add to Home Screen*.

### Domain

The app is called "יחד" (together). Names that looked unregistered (no DNS records) when this was set up, in rough order of preference. Availability is not guaranteed, confirm in Route 53 first:

`yachad.family`, `yachad.life`, `yachad.house`, `hayachad.app`, `yachadlife.com`

(`yachad.app`, `yachad.co.il` and `sidur.app` are already taken.) Register in Route 53 (Registered domains > Register), which creates the hosted zone automatically, then set `DOMAIN_NAME`. If you register elsewhere, create a Route 53 hosted zone and point the registrar's nameservers to it. A custom domain requires the stack to run in `us-east-1` (a CloudFront certificate requirement), which is the default.

### Deploy from GitHub

Pushes to `main` can deploy automatically, using short-lived OIDC credentials (no stored AWS keys).

```bash
aws cloudformation deploy --stack-name yachad-github-oidc --region us-east-1 \
  --template-file infra/github-oidc.yml --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubRepo=ofiri84/general
```

Then in the GitHub repo settings:

- Secret `AWS_ROLE_ARN`: the `RoleArn` output of that stack.
- Variables `DOMAIN_NAME`, `HOSTED_ZONE_DOMAIN` (optional), and `AWS_DEPLOY_ENABLED=true`.

`ci.yml` runs typecheck, tests, build and `cdk synth` on every branch and PR.

### Connect Google Drive

1. In Google Cloud Console create a project, enable the **Google Drive API**, and configure the OAuth consent screen (External, add both your Google accounts as test users).
2. Create an **OAuth client ID** (Web application) and add the `GoogleRedirectUri` stack output as an authorized redirect URI (for example `https://yachad.family/api/integrations/google/callback`).
3. Store the client in Secrets Manager (name is in the `GoogleSecretName` output):
   ```bash
   aws secretsmanager put-secret-value --secret-id <GoogleSecretName> \
     --secret-string '{"clientId":"...apps.googleusercontent.com","clientSecret":"..."}'
   ```
4. In the app: *חיבורים > Google Drive > חיבור*. Each partner connects their own Drive. Scopes: `drive.readonly` (search/read) and `drive.file` (files the app creates).

Apps in Google's "Testing" mode only allow listed test users and expire refresh tokens after 7 days. For permanent use, publish the consent screen (it stays unverified for personal use, with a warning screen) or verify it.

## Security and cost notes

- Sign-up is disabled in Cognito. Every API route except `/api/health` and the Google OAuth callback requires a valid JWT. The callback is protected by an HMAC-signed, 10-minute `state` and only accepts our own callback path.
- All members share one household (this is a two-person app by design). Chat history is private per user and expires after 90 days.
- The API is throttled (20 req/s, burst 40) to cap Bedrock spend. Expect a few dollars per month for two people. DynamoDB, Lambda, API Gateway and CloudFront are effectively free at this scale, Bedrock tokens are the only meaningful cost. Consider an AWS Budget alert.
- Voice uses the browser's built-in Hebrew speech recognition and synthesis (Chrome/Android and Safari/iOS). Quality of the spoken voice depends on the phone.

## Roadmap ideas

Google Calendar and Gmail tools, reminders via push/WhatsApp, recurring tasks, shopping-list mode, a scheduled "morning briefing" agent (EventBridge), Amazon Transcribe for higher-accuracy Hebrew dictation.

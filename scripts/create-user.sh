#!/usr/bin/env bash
# Creates a household member (no email sent, no temporary password).
# Usage: scripts/create-user.sh <email> "<display name>" <password> [stack-name]
set -euo pipefail

EMAIL=${1:?email}
NAME=${2:?display name}
PASSWORD=${3:?password (min 8 chars, upper+lower+digit)}
STACK=${4:-Yachad}
REGION=${AWS_REGION:-us-east-1}

POOL=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true Name=name,Value="$NAME" \
  --message-action SUPPRESS >/dev/null
aws cognito-idp admin-set-user-password --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" \
  --password "$PASSWORD" --permanent
echo "Created $NAME <$EMAIL>"

#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { RedAlertsStack } from "../lib/architecture/red-alerts-stack";
import * as CONSTANTS from "../constants";

const app = new cdk.App();

/*
  Sensitive / account-specific values are provided via CDK context (-c key=value)
  or environment variables. They are NEVER committed to git (see .env.example).

  Example:
    cdk deploy \
      -c account=123456789012 \
      -c certArn=arn:aws:acm:us-east-1:123456789012:certificate/xxxx \
      -c databaseUrl=mysql://user:pass@host:3306/red_alerts \
      -c vpcId=vpc-0123456789abcdef0 \
      -c subnetIds=subnet-aaa,subnet-bbb \
      -c dbSecurityGroupId=sg-0123456789abcdef0 \
      -c domain=red-alerts.example.com \
      -c hostedZone=example.com \
      -c imageTag=ab12cd3 \
      -c webAclArn=arn:aws:wafv2:us-east-1:123456789012:global/webacl/name/id
*/
// Target environment (dev/qa/prod). Drives the per-environment stack name so
// each environment is an INDEPENDENT CloudFormation stack. `make deploy <env>`
// passes it as `-c env=<env>`.
const environment: string = String(
  app.node.tryGetContext("env") ?? process.env.ENV ?? ""
)
  .trim()
  .toLowerCase();

const account: string | undefined =
  app.node.tryGetContext("account") ?? process.env.CDK_DEFAULT_ACCOUNT;

// Manual us-east-1 ACM certificate ARN (created by the operator beforehand).
const certArn: string | undefined = app.node.tryGetContext("certArn");

// Full MySQL connection URL (the CLOUD one) for the deployed Lambda + worker.
// Contains the password -> SECRET. Locally `make serve` uses the LOCAL url instead.
const databaseUrl: string | undefined = app.node.tryGetContext("databaseUrl");

// Existing VPC (where the private MySQL lives) that compute must join.
const vpcId: string | undefined = app.node.tryGetContext("vpcId");

// Optional: the DB's security group id. If provided, MySQL ingress from the app
// security group is added automatically; otherwise add it manually (see outputs).
// Treat an empty value (unset CI variable) as "not provided".
const dbSecurityGroupId: string | undefined =
  app.node.tryGetContext("dbSecurityGroupId") || undefined;

// Optional: explicit subnet ids (comma-separated) to place the Lambda + worker in.
// CDK can't know your subnet ids ahead of time, so provide them here for a
// deterministic placement. If omitted, CDK auto-selects the VPC's NAT-egress
// (private-with-egress) subnets. These subnets MUST have outbound internet
// (NAT) so the apps can reach SSM/IoT/Oref while also reaching the private DB.
const subnetIds: string[] = String(app.node.tryGetContext("subnetIds") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

// Full application domain served by CloudFront (e.g. red-alerts.example.com).
const domain: string | undefined = app.node.tryGetContext("domain");

// Route53 hosted zone that owns the domain (e.g. example.com). Defaults to domain.
const hostedZone: string | undefined =
  app.node.tryGetContext("hostedZone") ?? domain;

// Worker image tag to run (built/pushed by `make push-docker`). `make deploy`
// passes the current git short-sha so each push rolls the worker forward;
// defaults to "latest" (also pushed) when not provided.
const imageTag: string =
  app.node.tryGetContext("imageTag") || "latest";

// Optional: ARN of the shared CloudFront-scope WAF web ACL (shalev396-shared-acl,
// us-east-1) to attach to the distribution. Empty (unset WAF_WEB_ACL_ARN) -> no WAF.
const webAclArn: string | undefined =
  String(app.node.tryGetContext("webAclArn") ?? "").trim() || undefined;

if (!environment) {
  throw new Error(
    "Missing env. Pass -c env=dev|qa|prod (the Makefile passes this from `make deploy <env>`)."
  );
}
if (!account) {
  throw new Error(
    "Missing AWS account. Pass -c account=<id> or set CDK_DEFAULT_ACCOUNT."
  );
}
if (!certArn) {
  throw new Error(
    "Missing certArn. Create the ACM cert manually in us-east-1 and pass -c certArn=<arn>."
  );
}
if (!databaseUrl) {
  throw new Error(
    "Missing databaseUrl. Pass -c databaseUrl=mysql://user:pass@host:3306/db (the cloud connection)."
  );
}
if (!vpcId) {
  throw new Error(
    "Missing vpcId. The API Lambda and worker must join the database's VPC; pass -c vpcId=<vpc-id>."
  );
}
if (!domain || !hostedZone) {
  throw new Error("Missing domain/hostedZone. Pass -c domain=<...> -c hostedZone=<...>.");
}

new RedAlertsStack(app, CONSTANTS.stackName(environment), {
  env: {
    account,
    region: CONSTANTS.DEFAULT_REGION,
  },
  description:
    "Red Alerts backend - single-region CDK stack (il-central-1): API Lambda, ECS-on-EC2 Oref poller, IoT broadcast, CloudFront/S3/Route53.",
  certArn,
  databaseUrl,
  vpcId,
  subnetIds,
  dbSecurityGroupId,
  domain,
  hostedZoneName: hostedZone,
  imageTag,
  webAclArn,
});

// red-alerts-stack.ts - the "architect": wires every service construct together.

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import * as CONSTANTS from "../../constants";
import { resourceName } from "../naming";
import { AcmService } from "../acm_service";
import { IamService } from "../iam_service";
import { S3Service } from "../s3_service";
import { LambdaService } from "../lambda_service";
import { ApiGatewayService } from "../apigateway_service";
import { CloudfrontService } from "../cloudfront_service";
import { Route53Service } from "../route53_service";
import { IotService } from "../iot_service";
import { IotDomainService } from "../iot_domain_service";
import { CognitoService } from "../cognito_service";
import { EcsService } from "../ecs_service";

export interface RedAlertsStackProps extends cdk.StackProps {
  /** Manual us-east-1 ACM certificate ARN (CloudFront). */
  readonly certArn: string;
  /** Full MySQL connection URL (secret); used by the deployed Lambda + worker. */
  readonly databaseUrl: string;
  /** Id of the existing VPC that hosts the (private) MySQL database. */
  readonly vpcId: string;
  /** Explicit subnet ids for the Lambda + worker. Empty -> auto-select NAT subnets. */
  readonly subnetIds: string[];
  /** Optional: the DB's security group id; if set, an ingress rule is added. */
  readonly dbSecurityGroupId?: string;
  /** Full app domain served by CloudFront. */
  readonly domain: string;
  /** Route53 hosted zone that owns the domain. */
  readonly hostedZoneName: string;
  /** Worker image tag (in the ECR repo) to run - pushed by `make push-docker`. */
  readonly imageTag: string;
  /** Optional: shared WAF web ACL ARN (CloudFront scope) attached to the distribution. */
  readonly webAclArn?: string;
}

export class RedAlertsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RedAlertsStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Project", CONSTANTS.APPLICATION.APP_NAME);

    // resourceInfo carries created resources between services (kept clean & organized).
    const resourceInfo: Record<string, unknown> = {};

    // Per-env physical names (so dev/qa/prod can coexist in one account). The IoT
    // topic and ECR repo are namespaced per stack just like the CDK resources;
    // the worker reads the topic via env and the Makefile derives the same repo.
    const iotTopic = resourceName(this, CONSTANTS.IOT.BROADCAST_TOPIC);
    const workerRepositoryName = resourceName(this, CONSTANTS.ECR.WORKER_REPO);

    // --- Certificate (imported) ---
    const acmService = new AcmService(this, "AcmService", {
      certArn: props.certArn,
    });
    resourceInfo.certificate = acmService.certificate;

    // --- Networking: import the database's VPC + a shared app security group ---
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId });
    resourceInfo.vpc = vpc;

    // Where the Lambda + worker run. If explicit subnet ids were provided, use
    // exactly those; otherwise auto-select the VPC's NAT-egress subnets. Either
    // way these subnets must have outbound internet (NAT) AND reach the DB.
    const computeSubnets: ec2.SubnetSelection =
      props.subnetIds.length > 0
        ? {
            subnets: props.subnetIds.map((subnetId, index) =>
              ec2.Subnet.fromSubnetId(this, `ComputeSubnet${index}`, subnetId)
            ),
          }
        : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
    resourceInfo.computeSubnets = computeSubnets;

    // One security group shared by the API Lambda and the worker EC2 instances.
    // Outbound is open (NAT egress); inbound to MySQL is granted on the DB side.
    const appSecurityGroup = new ec2.SecurityGroup(this, "AppSecurityGroup", {
      vpc,
      description: "Red Alerts API Lambda + alerts worker (reaches private MySQL).",
      allowAllOutbound: true,
    });
    resourceInfo.appSecurityGroup = appSecurityGroup;

    // If the DB's security group id is provided, open MySQL ingress from our app
    // SG automatically; otherwise the operator adds it manually (SG id is output).
    if (props.dbSecurityGroupId) {
      // The MySQL port comes from the connection URL (defaults to 3306).
      const dbPort = Number(new URL(props.databaseUrl).port) || 3306;
      const dbSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        "DbSecurityGroup",
        props.dbSecurityGroupId,
        { mutable: true }
      );
      dbSecurityGroup.addIngressRule(
        appSecurityGroup,
        ec2.Port.tcp(dbPort),
        "Red Alerts app to MySQL"
      );
    }

    // --- IAM roles ---
    const iamService = new IamService(this, "IamService", {
      iotTopic,
    });
    resourceInfo.iamRoles = iamService;

    // --- S3 (client build bucket) ---
    const s3Service = new S3Service(this, "S3Service", {
      domain: props.domain,
    });
    resourceInfo.clientBucket = s3Service.clientBucket;

    // --- API Lambda ---
    const lambdaService = new LambdaService(this, "LambdaService", {
      apiRole: iamService.lambdaApiRole,
      vpc,
      vpcSubnets: computeSubnets,
      securityGroup: appSecurityGroup,
      databaseUrl: props.databaseUrl,
    });
    resourceInfo.apiFunction = lambdaService.apiFunction;

    // --- API Gateway ---
    const apiGatewayService = new ApiGatewayService(this, "ApiGatewayService", {
      apiFunction: lambdaService.apiFunction,
    });
    resourceInfo.httpApi = apiGatewayService.httpApi;

    // --- CloudFront ---
    const cloudfrontService = new CloudfrontService(this, "CloudfrontService", {
      clientBucket: s3Service.clientBucket,
      apiOriginDomain: apiGatewayService.apiOriginDomain,
      certificate: acmService.certificate,
      domain: props.domain,
      webAclArn: props.webAclArn,
    });
    resourceInfo.distribution = cloudfrontService.distribution;

    // --- Route53 ---
    new Route53Service(this, "Route53Service", {
      hostedZoneName: props.hostedZoneName,
      domain: props.domain,
      distribution: cloudfrontService.distribution,
    });

    // --- IoT (broadcast topic + subscriber permissions) ---
    const iotService = new IotService(this, "IotService", {
      topic: iotTopic,
    });
    resourceInfo.iot = iotService;

    // --- Cognito (unauth identity pool for browser IoT subscribe) ---
    const cognitoService = new CognitoService(this, "CognitoService", {
      iotSubscriberStatements: iotService.subscriberPolicyStatements(),
    });
    resourceInfo.identityPoolId = cognitoService.identityPoolId;

    // --- IoT custom domain (browsers connect to iot.<app-domain>) ---
    // prod -> iot.red-alerts.shalev396.com ; dev/qa -> iot.dev.red-alerts.shalev396.com
    // (the env, if any, comes from props.domain - prod has none).
    const iotDomain = `${CONSTANTS.IOT.DOMAIN_PREFIX}.${props.domain}`;
    new IotDomainService(this, "IotDomainService", {
      hostedZoneName: props.hostedZoneName,
      iotDomain,
    });

    // --- ECS worker (always-on Oref poller) ---
    new EcsService(this, "EcsService", {
      vpc,
      vpcSubnets: computeSubnets,
      securityGroup: appSecurityGroup,
      taskRole: iamService.workerTaskRole,
      executionRole: iamService.workerTaskExecutionRole,
      databaseUrl: props.databaseUrl,
      iotTopic,
      imageRepositoryName: workerRepositoryName,
      imageTag: props.imageTag,
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, "ClientBucketName", {
      value: s3Service.clientBucket.bucketName,
      description: "S3 bucket for the React client build (aws s3 sync target).",
    });
    new cdk.CfnOutput(this, "DistributionId", {
      value: cloudfrontService.distribution.distributionId,
      description: "CloudFront distribution id (for cache invalidation).",
    });
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: cloudfrontService.distribution.distributionDomainName,
      description: "CloudFront domain name.",
    });
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: apiGatewayService.httpApi.apiEndpoint,
      description: "API Gateway HTTP API endpoint.",
    });
    new cdk.CfnOutput(this, "AppDomain", {
      value: `https://${props.domain}`,
      description: "Public application URL.",
    });
    new cdk.CfnOutput(this, "IdentityPoolId", {
      value: cognitoService.identityPoolId,
      description: "Cognito identity pool id for anonymous IoT subscribers.",
    });
    new cdk.CfnOutput(this, "IotBroadcastTopic", {
      value: iotTopic,
      description: "IoT topic clients subscribe to for live alerts.",
    });
    new cdk.CfnOutput(this, "IotCustomDomain", {
      value: iotDomain,
      description:
        "Custom IoT data endpoint domain browsers connect to (MQTT-over-WSS). Set as ENDPOINT in the client realtime config.",
    });
    new cdk.CfnOutput(this, "AppSecurityGroupId", {
      value: appSecurityGroup.securityGroupId,
      description:
        "Security group for the API Lambda + worker. Allow inbound MySQL from this SG on the database.",
    });
  }
}

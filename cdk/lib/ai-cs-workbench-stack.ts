import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';

export interface AiCsWorkbenchConfig {
  prefix: string;
  knowledgeBaseId: string;
  modelId: string;
  systemPrompt: string;
}

export interface AiCsWorkbenchStackProps extends cdk.StackProps {
  config: AiCsWorkbenchConfig;
}

export class AiCsWorkbenchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AiCsWorkbenchStackProps) {
    super(scope, id, props);

    const { config } = props;
    const prefix = config.prefix ? `${config.prefix}-` : '';

    // ==================== DynamoDB Tables ====================

    const conversationsTable = new dynamodb.Table(this, 'ConversationsTable', {
      tableName: `${prefix}ai-cs-conversations`,
      partitionKey: { name: 'ticketId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    conversationsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'reviewStatus', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    conversationsTable.addGlobalSecondaryIndex({
      indexName: 'reviewer-index',
      partitionKey: { name: 'reviewedBy', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const configTable = new dynamodb.Table(this, 'ConfigTable', {
      tableName: `${prefix}ai-cs-config`,
      partitionKey: { name: 'configKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const ticketsTable = new dynamodb.Table(this, 'TicketsTable', {
      tableName: `${prefix}ai-cs-tickets`,
      partitionKey: { name: 'ticketId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    ticketsTable.addGlobalSecondaryIndex({
      indexName: 'status-birthTime-index',
      partitionKey: { name: 'reviewStatus', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'birthTime', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==================== Cognito ====================

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}ai-cs-workbench-users`,
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: `${prefix}ai-cs-workbench-client`,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      generateSecret: false,
    });

    // Admins group — members can edit system config (PUT /config)
    const adminsGroup = new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'admins',
      description: 'Administrators who can modify system configuration',
      precedence: 1,
    });

    // ==================== Lambda ====================

    const lambdaLayer = new lambda.LayerVersion(this, 'DepsLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output/python && cp *.py /asset-output/python/',
          ],
        },
      }),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'AI CS Workbench dependencies',
    });

    const handlerFunction = new lambda.Function(this, 'ApiHandler', {
      functionName: `${prefix}ai-cs-workbench-api`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp *.py /asset-output/ && echo "handler bundled"',
          ],
        },
      }),
      layers: [],
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        CONVERSATIONS_TABLE: conversationsTable.tableName,
        CONFIG_TABLE: configTable.tableName,
        TICKETS_TABLE: ticketsTable.tableName,
        KNOWLEDGE_BASE_ID: config.knowledgeBaseId,
        MODEL_ID: config.modelId,
        SYSTEM_PROMPT: config.systemPrompt,
        POWERTOOLS_SERVICE_NAME: 'ai-cs-workbench',
      },
    });

    // Grant Lambda permissions
    conversationsTable.grantReadWriteData(handlerFunction);
    configTable.grantReadWriteData(handlerFunction);
    ticketsTable.grantReadWriteData(handlerFunction);

    handlerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
        'bedrock:GetInferenceProfile',
        'bedrock:ListInferenceProfiles',
      ],
      resources: ['*'],
    }));

    // ==================== API Gateway ====================

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `${prefix}ai-cs-workbench-api`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key'],
        maxAge: cdk.Duration.days(1),
      },
    });

    const lambdaIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'LambdaIntegration',
      handlerFunction,
    );

    const authorizer = new apigatewayv2Authorizers.HttpUserPoolAuthorizer(
      'CognitoAuthorizer',
      userPool,
      { userPoolClients: [userPoolClient] },
    );

    // Webhook route - NO auth (called by AIHelp servers)
    httpApi.addRoutes({
      path: '/webhook/aihelp',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    // Authenticated routes
    const authRoutes = [
      { path: '/reviews', methods: [apigatewayv2.HttpMethod.GET] },
      { path: '/reviews/{ticketId}', methods: [apigatewayv2.HttpMethod.GET] },
      { path: '/reviews/{ticketId}/{timestamp}', methods: [apigatewayv2.HttpMethod.PATCH] },
      { path: '/reviews/{ticketId}/send', methods: [apigatewayv2.HttpMethod.POST] },
      { path: '/reviews/{ticketId}/regenerate', methods: [apigatewayv2.HttpMethod.POST] },
      { path: '/config', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT] },
      { path: '/dashboard/stats', methods: [apigatewayv2.HttpMethod.GET] },
    ];

    for (const route of authRoutes) {
      httpApi.addRoutes({
        path: route.path,
        methods: route.methods,
        integration: lambdaIntegration,
        authorizer,
      });
    }

    // ==================== Frontend Hosting ====================

    const websiteBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${prefix}ai-cs-workbench-frontend-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    // ==================== Outputs ====================

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url! });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'WebsiteBucketName', { value: websiteBucket.bucketName });
    new cdk.CfnOutput(this, 'ConversationsTableName', { value: conversationsTable.tableName });
    new cdk.CfnOutput(this, 'ConfigTableName', { value: configTable.tableName });
    new cdk.CfnOutput(this, 'TicketsTableName', { value: ticketsTable.tableName });
    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: `${httpApi.url}webhook/aihelp`,
      description: 'Configure this URL in AIHelp webhook settings',
    });
  }
}

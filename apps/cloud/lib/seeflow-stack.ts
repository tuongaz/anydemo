import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

interface SeeflowStackProps extends cdk.StackProps {
  certificate: acm.ICertificate;
}

export class SeeflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SeeflowStackProps) {
    super(scope, id, props);

    const diagramsBucket = new s3.Bucket(this, 'DiagramsBucket', {
      bucketName: 'seeflow-diagrams',
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const viewerBucket = new s3.Bucket(this, 'ViewerBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const apiFunction = new lambdaNodejs.NodejsFunction(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/api/index.ts'),
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(15),
      environment: {
        DIAGRAMS_BUCKET_NAME: diagramsBucket.bucketName,
      },
    });

    diagramsBucket.grantReadWrite(apiFunction);

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'SeeflowApi',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', apiFunction);

    httpApi.addRoutes({
      path: '/flows',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
    });

    httpApi.addRoutes({
      path: '/flows/{uuid}',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    httpApi.addRoutes({
      path: '/flows/{uuid}/files/{proxy+}',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    // CloudFront Function strips /api prefix before forwarding to API Gateway
    const pathRewriteFn = new cloudfront.Function(this, 'ApiPathRewriteFunction', {
      code: cloudfront.FunctionCode.fromInline(
        'function handler(event){var r=event.request;var u=r.uri;if(u.indexOf("/api")===0){r.uri=u.slice(4)||"/";}return r;}',
      ),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // S3 origin with OAC (automatically adds bucket policy for CloudFront)
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(viewerBucket);

    // API Gateway origin — domain extracted from full endpoint URL
    const apiDomainName = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));
    const apiOrigin = new origins.HttpOrigin(apiDomainName);

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      certificate: props.certificate,
      domainNames: ['seeflow.dev'],
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: pathRewriteFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
      // SPA fallback: serve index.html for any missing S3 paths
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'seeflow.dev',
    });

    new route53.ARecord(this, 'ARecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    });

    new cdk.CfnOutput(this, 'DiagramsBucketName', {
      value: diagramsBucket.bucketName,
      exportName: 'SeeflowDiagramsBucketName',
    });

    new cdk.CfnOutput(this, 'ViewerBucketName', {
      value: viewerBucket.bucketName,
      exportName: 'SeeflowViewerBucketName',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      exportName: 'SeeflowApiUrl',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      exportName: 'SeeflowCloudFrontDomain',
    });
  }
}

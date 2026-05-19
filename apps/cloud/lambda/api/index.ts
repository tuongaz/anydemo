import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { unzipSync } from 'fflate';

const s3 = new S3Client({});
const BUCKET = process.env.DIAGRAMS_BUCKET_NAME ?? '';

const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function handlePostFlows(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const email = event.queryStringParameters?.email;
  if (!email) {
    return json(400, { error: 'Missing email' });
  }

  const bodyStr = event.body ?? '';
  const zipBytes = event.isBase64Encoded
    ? Buffer.from(bodyStr, 'base64')
    : Buffer.from(bodyStr, 'binary');

  if (zipBytes.length > MAX_TOTAL) {
    return json(413, { error: 'Upload too large' });
  }

  let unzipped: ReturnType<typeof unzipSync>;
  try {
    unzipped = unzipSync(new Uint8Array(zipBytes));
  } catch {
    return json(400, { error: 'Invalid zip file' });
  }

  for (const data of Object.values(unzipped)) {
    if (data.length > MAX_FILE) {
      return json(413, { error: 'File too large' });
    }
  }

  const uuid = randomUUID();

  for (const [filePath, data] of Object.entries(unzipped)) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${uuid}/${filePath}`,
        Body: data,
      }),
    );
  }

  const name = event.queryStringParameters?.name ?? '';

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${uuid}/metadata.json`,
      Body: JSON.stringify({ email, name, createdAt: new Date().toISOString() }),
      ContentType: 'application/json',
    }),
  );

  return json(201, { url: `https://seeflow.dev/flow/${uuid}` });
}

async function handleGetFlows(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const page = Math.max(1, Number.parseInt(event.queryStringParameters?.page ?? '1', 10) || 1);
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(event.queryStringParameters?.limit ?? '12', 10) || 12),
  );

  // List all objects and filter to flow.json keys (public flows only)
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));

  const objects = (listed.Contents ?? [])
    .filter((o) => o.Key?.endsWith('/flow.json'))
    .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

  const total = objects.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const slice = objects.slice((page - 1) * limit, page * limit);

  const flows = await Promise.all(
    slice.map(async (obj) => {
      const uuid = obj.Key?.replace('/flow.json', '');
      const [demoRes, metaRes] = await Promise.all([
        s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${uuid}/flow.json` })),
        s3
          .send(new GetObjectCommand({ Bucket: BUCKET, Key: `${uuid}/metadata.json` }))
          .catch(() => null),
      ]);

      const demoStr = await demoRes.Body?.transformToString('utf-8');
      const demo = JSON.parse(demoStr ?? '{}');
      if (!Array.isArray(demo.nodes)) demo.nodes = [];
      if (!Array.isArray(demo.connectors)) demo.connectors = [];

      let name = demo.name ?? '';
      let createdAt = obj.LastModified?.toISOString() ?? new Date().toISOString();

      if (metaRes) {
        const metaStr = await metaRes.Body?.transformToString('utf-8').catch(() => null);
        if (metaStr) {
          const meta = JSON.parse(metaStr);
          if (meta.name) name = meta.name;
          if (meta.createdAt) createdAt = meta.createdAt;
        }
      }

      return { uuid, name, createdAt, demo };
    }),
  );

  return json(200, { flows, total, page, totalPages });
}

async function handleGetFlow(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const uuid = event.pathParameters?.uuid;
  if (!uuid) return json(400, { error: 'Missing uuid' });

  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${uuid}/flow.json` }),
    );
    const body = await result.Body?.transformToString('utf-8');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: body ?? '',
    };
  } catch {
    return json(404, { error: 'Not found' });
  }
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  txt: 'text/plain',
};

async function handleGetFlowFile(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const uuid = event.pathParameters?.uuid;
  const proxy = event.pathParameters?.proxy;
  if (!uuid || !proxy) return json(400, { error: 'Missing parameters' });

  const ext = proxy.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${uuid}/files/${proxy}` }),
    );
    const bytes = await result.Body?.transformToByteArray();
    return {
      statusCode: 200,
      headers: { 'Content-Type': contentType },
      body: bytes ? Buffer.from(bytes).toString('base64') : '',
      isBase64Encoded: true,
    };
  } catch {
    return json(404, { error: 'Not found' });
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const routeKey = event.routeKey;

  if (routeKey === 'GET /flows') return handleGetFlows(event);
  if (routeKey === 'POST /flows') return handlePostFlows(event);
  if (routeKey === 'GET /flows/{uuid}') return handleGetFlow(event);
  if (routeKey === 'GET /flows/{uuid}/files/{proxy+}') return handleGetFlowFile(event);

  return json(404, { error: 'Not found' });
};

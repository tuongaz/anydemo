---
techId: localstack
category: local-infra
---

# LocalStack

> **General guidance only.** Check `<projectPath>/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- LocalStack itself is **infra glue, not a node**. Model each LocalStack-
  backed AWS service (s3 bucket, sqs queue, sns topic, dynamodb table) as its
  own `stateNode` with the matching `kind` (`s3`, `aws-sqs`, etc.).
- The node's play/status scripts override the AWS endpoint to point at
  `http://localhost:4566` — otherwise identical to the real-cloud refs.

## Play (trigger locally)

- Set `AWS_ENDPOINT_URL=http://localhost:4566` (global) or per-service
  `AWS_ENDPOINT_URL_S3=...` for the AWS SDK v2 / v3.
- Use stub credentials: `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`,
  `AWS_REGION=us-east-1`.
- Create the resource (bucket/queue/topic) if missing — LocalStack starts empty.

```go
package main

import (
	"context"
	"fmt"
	"strings"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func main() {
	ctx := context.Background()
	cfg, _ := config.LoadDefaultConfig(ctx,
		config.WithRegion("us-east-1"),
		config.WithBaseEndpoint("http://localhost:4566"))
	cli := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
	_, _ = cli.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String("demo")})
	_, err := cli.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String("demo"), Key: aws.String("hello.txt"),
		Body: strings.NewReader("hi"),
	})
	if err != nil { panic(err) }
	fmt.Println(`{"bucket":"demo","key":"hello.txt"}`)
}
```

## Status (read locally)

- Reuse the real-service status pattern, just with the endpoint override.
- Cheap signal: `ListObjectsV2` (max 1), `GetQueueAttributes`, `Scan` limit 1.
- Tolerate `404 NoSuchBucket` / missing queue — emit `state: "warn"`.

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background(),
		config.WithRegion("us-east-1"),
		config.WithBaseEndpoint("http://localhost:4566"))
	cli := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
	enc := json.NewEncoder(os.Stdout)
	for {
		out, err := cli.ListObjectsV2(context.Background(),
			&s3.ListObjectsV2Input{Bucket: aws.String("demo"), MaxKeys: aws.Int32(1)})
		st := "ok"; n := 0
		if err != nil { st = "warn" } else { n = len(out.Contents) }
		_ = enc.Encode(map[string]any{"state": st, "summary": fmt.Sprintf("%d objs", n),
			"data": map[string]int{"count": n}, "ts": time.Now().UTC().Format(time.RFC3339)})
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Path-style addressing is **required** (`UsePathStyle: true`) — virtual-host
  style needs DNS tricks LocalStack does not ship.
- State is wiped on container restart unless `PERSISTENCE=1` is set and a
  volume is mounted at `/var/lib/localstack`.
- SQS queue URLs returned by LocalStack contain the gateway hostname
  (`sqs.us-east-1.localhost.localstack.cloud:4566`) — pass them as-is; do not
  rewrite to `localhost:4566`, that breaks signing.
- Pro features (RDS, IAM enforcement, Lambda hot-reload) silently no-op on the
  free image — check `ServiceResponse: not implemented` in logs.

## Fixture shape

```json
{ "bucket": "demo", "key": "events/2026-05-20/sample.json", "size": 128 }
```

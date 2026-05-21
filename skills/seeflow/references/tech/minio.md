---
techId: minio
category: local-infra
---

# MinIO

> **General guidance only.** Check `<project>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per **bucket** the flow touches — same shape as the real
  `s3` ref; only the endpoint and creds differ.
- If the demo shows upload → process → archive, model the two buckets as two
  nodes; do not collapse them just because they share a server.

## Play (trigger locally)

- Use the AWS SDK v2 with endpoint override (`http://localhost:9000`),
  `UsePathStyle: true`, and the default `minioadmin/minioadmin` creds unless
  the compose file overrides them.
- Create the bucket if missing; MinIO returns `BucketAlreadyOwnedByYou` on
  re-create, which is safe to swallow.

```go
package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func main() {
	ctx := context.Background()
	cfg, _ := config.LoadDefaultConfig(ctx,
		config.WithRegion("us-east-1"),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("minioadmin", "minioadmin", "")),
		config.WithBaseEndpoint("http://localhost:9000"))
	cli := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
	_, _ = cli.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String("uploads")})
	_, err := cli.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String("uploads"), Key: aws.String("hello.txt"),
		Body: strings.NewReader("hi"),
	})
	if err != nil { panic(err) }
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"bucket": "uploads", "key": "hello.txt"})
}
```

## Status (read locally)

- Cheapest read: `ListObjectsV2` with `MaxKeys: 1` per bucket.
- Report object count + newest key. On `NoSuchBucket`, emit `state: "warn"`
  and keep polling — the play script may not have run yet.

```go
package main

import (
	"context"
	"encoding/json"
	"os"
	"time"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background(),
		config.WithRegion("us-east-1"),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("minioadmin", "minioadmin", "")),
		config.WithBaseEndpoint("http://localhost:9000"))
	cli := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
	enc := json.NewEncoder(os.Stdout)
	for {
		out, err := cli.ListObjectsV2(context.Background(),
			&s3.ListObjectsV2Input{Bucket: aws.String("uploads"), MaxKeys: aws.Int32(1)})
		st := "ok"; n := 0
		if err != nil { st = "warn" } else { n = len(out.Contents) }
		_ = enc.Encode(map[string]any{"state": st, "summary": "polled",
			"data": map[string]int{"count": n}, "ts": time.Now().UTC().Format(time.RFC3339)})
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- `UsePathStyle: true` is non-negotiable — virtual-host style requires DNS
  wildcards MinIO does not configure by default.
- The console runs on a **separate port** (9001 by default). Hitting `:9001`
  with the SDK returns HTML and a cryptic XML parse error.
- Default region is `us-east-1`; mismatched regions trigger redirects the
  SDK will follow but lambda-style policies will reject.
- `mc` CLI uses its own alias config (`~/.mc/config.json`) — env vars do not
  flow through to it; configure with `mc alias set local …` once.

## Fixture shape

```json
{ "bucket": "uploads", "key": "events/2026-05-20/sample.json", "size": 128, "contentType": "application/json" }
```

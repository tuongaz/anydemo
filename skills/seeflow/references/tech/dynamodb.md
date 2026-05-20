---
techId: dynamodb
category: storage
---

# AWS DynamoDB

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per table, not per partition or GSI.
- Duplicate the table node next to each consumer for readability
  (same `kind` + `name`, unique `id`).

## Play (trigger locally)

- Reuse a project repo helper over raw `PutItem` when one exists.
- Honour `AWS_ENDPOINT_URL_DYNAMODB` so DynamoDB Local / LocalStack
  works without code change.
- Item keys must match the table's hash/range schema exactly — pull
  from a fixture, never invent.

```go
package main

import (
	"context"; "fmt"; "time"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background())
	c := dynamodb.NewFromConfig(cfg)
	id := fmt.Sprintf("o_%d", time.Now().UnixNano())
	_, err := c.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: aws.String("orders"),
		Item: map[string]types.AttributeValue{
			"id":    &types.AttributeValueMemberS{Value: id},
			"total": &types.AttributeValueMemberN{Value: "4200"},
		},
	})
	if err != nil { panic(err) }
	println("put", id)
}
```

## Status (read locally)

- Prefer `Query` on a known partition over `Scan`. Always set `Limit`.
- Emit `StatusReport` JSON per tick.
- `ResourceNotFoundException` → `state: "warn"`, not panic.

```go
package main

import (
	"context"; "encoding/json"; "fmt"; "time"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background())
	c := dynamodb.NewFromConfig(cfg)
	for {
		out, err := c.Scan(context.Background(), &dynamodb.ScanInput{TableName: aws.String("orders"), Limit: aws.Int32(20)})
		state := "ok"; if err != nil { state = "warn" }
		n := int32(0); if out != nil { n = out.Count }
		b, _ := json.Marshal(map[string]any{"state":state,"summary":fmt.Sprintf("%d items",n),"data":map[string]int32{"count":n},"ts":time.Now().Unix()})
		println(string(b))
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- DynamoDB Local uses an in-memory store by default — restart = empty.
  Use `-sharedDb` + `-dbPath` for persistence.
- `PutItem` overwrites by key silently; use `ConditionExpression
  attribute_not_exists(id)` for true insert semantics.
- Region is required even against local — `AWS_REGION=us-east-1` is the
  conventional placeholder; LocalStack ignores credentials but not region.

## Fixture shape

```json
{ "id": { "S": "o_1716200000000" }, "total": { "N": "4200" }, "created_at": { "S": "2026-05-20T12:00:00Z" } }
```

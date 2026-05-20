---
techId: aws-sqs
category: messaging
---

# AWS SQS

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per queue. A DLQ is a separate node — never conflate
  it with its source queue.
- FIFO queues (`*.fifo`) and standard queues have different ordering
  guarantees; label `data.note` accordingly.
- Duplicate the queue node next to each consumer for readability
  (same `kind` + `name`, unique `id`).

## Play (trigger locally)

- Reuse any project sender helper before a raw client.
- Point at LocalStack via `AWS_ENDPOINT_URL` / custom resolver so the
  script never hits real SQS.
- FIFO queues require `MessageGroupId` (and dedup id) — omitting either
  is a 400.

```go
package main

import (
	"context"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/aws"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background())
	c := sqs.NewFromConfig(cfg)
	out, _ := c.SendMessage(context.Background(), &sqs.SendMessageInput{
		QueueUrl:    aws.String("http://localhost:4566/000000000000/orders"),
		MessageBody: aws.String(`{"id":"o_1","total":42}`),
	})
	println("sent", aws.ToString(out.MessageId))
}
```

## Status (read locally)

- `ReceiveMessage` with `MaxNumberOfMessages: 1`, `WaitTimeSeconds: 1`,
  then `DeleteMessage` to ACK.
- Use `ApproximateNumberOfMessages` for `data` only (eventually
  consistent — never branch `state` on it).

```go
package main

import (
	"context"; "encoding/json"; "time"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/aws"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background())
	c := sqs.NewFromConfig(cfg)
	url := aws.String("http://localhost:4566/000000000000/orders")
	for {
		out, _ := c.ReceiveMessage(context.Background(), &sqs.ReceiveMessageInput{QueueUrl: url, MaxNumberOfMessages: 1, WaitTimeSeconds: 1})
		state := "warn"; var body string
		if len(out.Messages) > 0 { state = "ok"; body = aws.ToString(out.Messages[0].Body); c.DeleteMessage(context.Background(), &sqs.DeleteMessageInput{QueueUrl: url, ReceiptHandle: out.Messages[0].ReceiptHandle}) }
		b, _ := json.Marshal(map[string]any{"state": state, "summary": "1 poll", "data": body, "ts": time.Now().Unix()})
		println(string(b)); time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Long-poll (`WaitTimeSeconds > 0`) vs short-poll changes empty-receive
  cost and latency; short-poll can return empty even with messages.
- FIFO queues need `MessageGroupId` on every send and dedup either
  content-based or via `MessageDeduplicationId`.
- `ApproximateNumberOfMessages` lags by seconds — never gate flow state
  on it.
- LocalStack queue URLs include account `000000000000`; real AWS uses
  your real account id.

## Fixture shape

```json
{ "MessageId": "...", "ReceiptHandle": "...", "Body": "{\"id\":\"o_1\"}", "MessageAttributes": { "source": { "DataType": "String", "StringValue": "play" } } }
```

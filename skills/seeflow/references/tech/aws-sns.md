---
techId: aws-sns
category: messaging
---

# AWS SNS

> **General guidance only.** Check `<projectPath>/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per topic. If the topic fans out to N subscribers
  (SQS / Lambda / HTTPS), model each subscriber as its own consumer
  node — the SNS node is just the broadcast point.
- Duplicate the topic node next to each subscriber for readability
  (same `kind` + `name`, unique `id`).

## Play (trigger locally)

- Reuse any project publisher helper before a raw client.
- Point at LocalStack via `AWS_ENDPOINT_URL`; SNS topic ARNs there use
  account `000000000000`.
- Include `MessageAttributes` if subscriptions use filter policies —
  without them the message silently never delivers.

```go
package main

import (
	"context"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/aws"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background())
	c := sns.NewFromConfig(cfg)
	out, _ := c.Publish(context.Background(), &sns.PublishInput{
		TopicArn: aws.String("arn:aws:sns:us-east-1:000000000000:orders"),
		Message:  aws.String(`{"id":"o_1","total":42}`),
	})
	println("published", aws.ToString(out.MessageId))
}
```

## Status (read locally)

- SNS is fire-and-forget — there is no "queue depth" to poll. Status
  must read the **downstream subscription's** state: SQS queue depth,
  a log line in the HTTPS subscriber, a Lambda invocation count.
- Pick whichever subscriber the flow narrates and use *its* status ref
  (e.g. `aws-sqs.md`) for the read recipe.
- The example below uses `ListSubscriptionsByTopic` as a liveness probe
  for the topic itself.

```go
package main

import (
	"context"; "encoding/json"; "fmt"; "time"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/aws"
)

func main() {
	cfg, _ := config.LoadDefaultConfig(context.Background())
	c := sns.NewFromConfig(cfg)
	arn := aws.String("arn:aws:sns:us-east-1:000000000000:orders")
	for {
		out, err := c.ListSubscriptionsByTopic(context.Background(), &sns.ListSubscriptionsByTopicInput{TopicArn: arn})
		state := "ok"; n := 0
		if err != nil { state = "warn" } else { n = len(out.Subscriptions) }
		b, _ := json.Marshal(map[string]any{"state": state, "summary": fmt.Sprintf("%d subs", n), "data": n, "ts": time.Now().Unix()})
		println(string(b)); time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- SNS does **not** retain messages — if no subscription is attached at
  publish time, the message is lost. Status reads the subscriber, not
  the topic.
- Subscription filter policies silently drop non-matching messages —
  the publisher sees success regardless.
- FIFO topics require `MessageGroupId` and `MessageDeduplicationId`.
- LocalStack topic ARNs use account `000000000000`; real AWS uses your
  real account id and region.

## Fixture shape

```json
{ "MessageId": "...", "TopicArn": "arn:aws:sns:us-east-1:000000000000:orders", "Message": "{\"id\":\"o_1\"}", "MessageAttributes": { "source": { "Type": "String", "Value": "play" } } }
```

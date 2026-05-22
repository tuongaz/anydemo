---
techId: ruby
category: language
---

# Ruby

> **General guidance only.** Check `<projectPath>/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Languages don't drive node modelling; consult the tech-specific refs
  (`tech/postgres.md`, `tech/google-pubsub.md`, etc.) for resource node
  guidance.
- Interpreter wiring: `playAction.interpreter: "ruby"`, `args: []`. If
  the project uses Bundler, switch to `interpreter: "bundle"` with
  `args: ["exec", "ruby"]` so gems resolve.

## Play (trigger locally)

- Stay on stdlib `Net::HTTP` — don't pull `rest-client`, `faraday`, or
  `httparty` unless the project's Gemfile already includes them.
- Read fixture with `JSON.parse(STDIN.read)`; tolerate empty input.
- Idempotency: stable id from fixture, not `Time.now.to_i` alone.

```ruby
#!/usr/bin/env ruby
require 'json'; require 'net/http'; require 'uri'

raw = STDIN.read
raw = '{}' if raw.nil? || raw.strip.empty?
input = JSON.parse(raw) rescue {}
id = input['id'] || 'demo-1'

begin
  uri = URI('http://localhost:8080/orders')
  req = Net::HTTP::Post.new(uri, 'content-type' => 'application/json')
  req.body = JSON.generate(id: id, total: 4200)
  res = Net::HTTP.start(uri.host, uri.port, open_timeout: 2, read_timeout: 5) { |h| h.request(req) }
  if res.code.to_i >= 300
    warn "http #{res.code}"
    exit 1
  end
  puts JSON.generate(ok: true, id: id)
rescue => e
  warn "play failed: #{e.message}"
  exit 1
end
```

## Status (read locally)

- `STDOUT.sync = true` at the top — Ruby buffers stdout by default and
  the UI will appear frozen otherwise.
- Loop with `Kernel.sleep 1`; one read + one `puts JSON.generate(...)`
  per tick.
- Rescue the read, emit `state: "warn"`, keep ticking.

```ruby
#!/usr/bin/env ruby
require 'json'; require 'net/http'; require 'uri'

STDOUT.sync = true

loop do
  state, summary, count = 'ok', '0 orders', 0
  begin
    uri = URI('http://localhost:8080/orders/count')
    res = Net::HTTP.start(uri.host, uri.port, open_timeout: 2, read_timeout: 2) do |h|
      h.get(uri.request_uri)
    end
    raise "http #{res.code}" if res.code.to_i >= 300
    body = JSON.parse(res.body || '{}')
    count = (body['count'] || 0).to_i
    summary = "#{count} orders"
  rescue => e
    state, summary = 'warn', e.message
  end
  puts JSON.generate(state: state, summary: summary, data: { count: count }, ts: Time.now.to_i)
  sleep 1
end
```

## Gotchas

- `STDOUT.sync = true` is mandatory for status scripts — without it,
  buffered output makes the demo look hung.
- Bundler projects: invoke as `bundle exec ruby script.rb` (set
  `interpreter: "bundle"`, `args: ["exec", "ruby"]`). Plain `ruby` will
  miss gems.
- System Ruby vs `rbenv`/`asdf`: respect the project's `.ruby-version`;
  call the resolved shim, not `/usr/bin/ruby`.
- `Net::HTTP.start` without a block leaks the socket — always use the
  block form.

## Fixture shape

```json
{ "id": "demo-1", "total": 4200 }
```

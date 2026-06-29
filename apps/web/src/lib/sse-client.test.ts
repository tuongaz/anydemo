import { describe, expect, it } from 'bun:test';
import { type SseEvent, createSseParser } from './sse-client.ts';

const collect = () => {
  const events: Array<{ type: string; event: SseEvent }> = [];
  const parser = createSseParser((type, event) => events.push({ type, event }));
  return { events, parser };
};

describe('createSseParser', () => {
  it('dispatches a named event with its data payload', () => {
    const { events, parser } = collect();
    parser.feed('event: hello\ndata: {"ok":true}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('hello');
    expect(events[0]?.event.data).toBe('{"ok":true}');
  });

  it('defaults the event type to "message" when no event field is present', () => {
    const { events, parser } = collect();
    parser.feed('data: plain\n\n');
    expect(events[0]?.type).toBe('message');
    expect(events[0]?.event.data).toBe('plain');
  });

  it('joins multi-line data with newlines', () => {
    const { events, parser } = collect();
    parser.feed('data: line1\ndata: line2\n\n');
    expect(events[0]?.event.data).toBe('line1\nline2');
  });

  it('ignores comment/heartbeat lines and id-only frames', () => {
    const { events, parser } = collect();
    parser.feed(':keep-alive\n\n');
    parser.feed('id: 7\n\n');
    expect(events).toHaveLength(0);
  });

  it('carries the last id forward onto subsequent events', () => {
    const { events, parser } = collect();
    parser.feed('id: 42\ndata: a\n\n');
    expect(events[0]?.event.lastEventId).toBe('42');
  });

  it('buffers partial frames across feed() calls', () => {
    const { events, parser } = collect();
    parser.feed('event: flow:reload\nda');
    expect(events).toHaveLength(0);
    parser.feed('ta: {"valid":true}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('flow:reload');
    expect(events[0]?.event.data).toBe('{"valid":true}');
  });

  it('handles CRLF frame boundaries', () => {
    const { events, parser } = collect();
    parser.feed('event: flow:reload\r\ndata: x\r\n\r\n');
    expect(events[0]?.type).toBe('flow:reload');
    expect(events[0]?.event.data).toBe('x');
  });

  it('parses multiple frames in one chunk', () => {
    const { events, parser } = collect();
    parser.feed('data: one\n\ndata: two\n\n');
    expect(events.map((e) => e.event.data)).toEqual(['one', 'two']);
  });
});

import { describe, expect, it } from 'bun:test';
import { JqError, applyJq } from './jq-filter.ts';

describe('jq-filter (path subset)', () => {
  describe('identity', () => {
    it('. returns the input value as a single-element stream', () => {
      expect(applyJq({ a: 1 }, '.')).toEqual([{ a: 1 }]);
      expect(applyJq(null, '.')).toEqual([null]);
      expect(applyJq([1, 2], '.')).toEqual([[1, 2]]);
    });
  });

  describe('field access', () => {
    it('.foo extracts a top-level field', () => {
      expect(applyJq({ foo: 42 }, '.foo')).toEqual([42]);
    });

    it('.foo.bar chains across nested objects', () => {
      expect(applyJq({ foo: { bar: 'x' } }, '.foo.bar')).toEqual(['x']);
    });

    it('missing field returns null (jq parity)', () => {
      expect(applyJq({}, '.foo')).toEqual([null]);
      expect(applyJq({ foo: null }, '.foo.bar')).toEqual([null]);
    });

    it('indexing a non-object throws JqError', () => {
      expect(() => applyJq([1, 2], '.foo')).toThrow(JqError);
      expect(() => applyJq(5, '.foo')).toThrow(JqError);
    });

    it("'?' suppresses type errors", () => {
      expect(applyJq([1, 2], '.foo?')).toEqual([]);
      expect(applyJq(5, '.foo?')).toEqual([]);
    });
  });

  describe('bracket access', () => {
    it('.["foo"] is equivalent to .foo', () => {
      expect(applyJq({ foo: 1 }, '.["foo"]')).toEqual([1]);
      expect(applyJq({ foo: 1 }, ".['foo']")).toEqual([1]);
    });

    it('bracket-string keys can contain dots and dashes', () => {
      expect(applyJq({ 'foo.bar': 1 }, '.["foo.bar"]')).toEqual([1]);
      expect(applyJq({ 'a-b': 2 }, '.["a-b"]')).toEqual([2]);
    });

    it('numeric index reads array positions, negatives count from end', () => {
      expect(applyJq([10, 20, 30], '.[0]')).toEqual([10]);
      expect(applyJq([10, 20, 30], '.[2]')).toEqual([30]);
      expect(applyJq([10, 20, 30], '.[-1]')).toEqual([30]);
      expect(applyJq([10, 20, 30], '.[5]')).toEqual([null]);
    });

    it('numeric index on non-array errors', () => {
      expect(() => applyJq({ a: 1 }, '.[0]')).toThrow(JqError);
      expect(applyJq({ a: 1 }, '.[0]?')).toEqual([]);
    });
  });

  describe('iteration', () => {
    it('.[] over an array yields each element', () => {
      expect(applyJq([1, 2, 3], '.[]')).toEqual([1, 2, 3]);
    });

    it('.[] over an object yields each value', () => {
      expect(applyJq({ a: 1, b: 2 }, '.[]')).toEqual([1, 2]);
    });

    it('.foo[] chains after field access', () => {
      expect(applyJq({ foo: [1, 2, 3] }, '.foo[]')).toEqual([1, 2, 3]);
    });

    it('chained iteration multiplies the stream', () => {
      expect(applyJq({ a: [1, 2], b: [3, 4] }, '.[][]')).toEqual([1, 2, 3, 4]);
    });

    it('.[] over null/scalar errors without ?', () => {
      expect(() => applyJq(null, '.[]')).toThrow(JqError);
      expect(() => applyJq(5, '.[]')).toThrow(JqError);
      expect(applyJq(null, '.[]?')).toEqual([]);
      expect(applyJq(5, '.[]?')).toEqual([]);
    });
  });

  describe('pipe', () => {
    it('left | right applies right to each output of left', () => {
      expect(applyJq({ foo: { bar: 1 } }, '.foo | .bar')).toEqual([1]);
    });

    it('pipe after iteration projects each element', () => {
      expect(applyJq({ xs: [{ n: 1 }, { n: 2 }] }, '.xs[] | .n')).toEqual([1, 2]);
    });

    it('whitespace around | is tolerated', () => {
      expect(applyJq({ a: { b: 7 } }, '  .a   |   .b  ')).toEqual([7]);
    });
  });

  describe('errors', () => {
    it('empty filter throws', () => {
      expect(() => applyJq({}, '')).toThrow(JqError);
    });

    it('missing leading dot throws', () => {
      expect(() => applyJq({ foo: 1 }, 'foo')).toThrow(JqError);
    });

    it('unterminated bracket throws', () => {
      expect(() => applyJq([1], '.[')).toThrow(JqError);
    });

    it('unknown trailing character throws', () => {
      expect(() => applyJq({}, '.foo ~ .bar')).toThrow(JqError);
    });
  });

  describe('schema-shaped payloads (real use case)', () => {
    const payload = {
      name: 'node',
      schemas: {
        rectangle: {
          type: 'object',
          properties: { data: { properties: { name: { description: 'label' } } } },
        },
        image: {
          type: 'object',
          properties: {
            data: { properties: { path: { description: 'image path', type: 'string' } } },
          },
        },
      },
      notes: ['first note', 'second note'],
    };

    it('extracts a single node variant', () => {
      const out = applyJq(payload, '.schemas.rectangle');
      expect(out).toEqual([
        {
          type: 'object',
          properties: { data: { properties: { name: { description: 'label' } } } },
        },
      ]);
    });

    it('drills into a specific field schema', () => {
      const out = applyJq(payload, '.schemas.image.properties.data.properties.path');
      expect(out).toEqual([{ description: 'image path', type: 'string' }]);
    });

    it('iterates every variant', () => {
      const out = applyJq(payload, '.schemas[]');
      expect(out).toHaveLength(2);
    });

    it('reads a single note by index', () => {
      expect(applyJq(payload, '.notes[0]')).toEqual(['first note']);
    });
  });
});

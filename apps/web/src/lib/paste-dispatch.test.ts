import { describe, expect, it } from 'bun:test';
import { decidePasteAction } from './paste-dispatch';

const imageItem = { kind: 'file', type: 'image/png' };
const textItem = { kind: 'string', type: 'text/plain' };

describe('decidePasteAction', () => {
  it('ignores when an editable surface is focused', () => {
    expect(decidePasteAction({ isEditable: true, items: [imageItem], text: '' }).kind).toBe(
      'ignore',
    );
  });

  it('chooses image when clipboard holds an image file', () => {
    expect(decidePasteAction({ isEditable: false, items: [imageItem], text: '' }).kind).toBe(
      'image',
    );
  });

  it('prefers image over text when both present', () => {
    expect(
      decidePasteAction({ isEditable: false, items: [imageItem, textItem], text: '{...}' }).kind,
    ).toBe('image');
  });

  it('chooses nodes when text parses as a seeflow envelope', () => {
    const text = '{"__seeflow_clipboard__":1,"nodes":[],"connectors":[]}';
    const action = decidePasteAction({ isEditable: false, items: [textItem], text });
    expect(action.kind).toBe('nodes');
    if (action.kind === 'nodes') expect(action.payload.nodes).toEqual([]);
  });

  it('ignores plain non-seeflow text', () => {
    expect(decidePasteAction({ isEditable: false, items: [textItem], text: 'hi' }).kind).toBe(
      'ignore',
    );
  });
});

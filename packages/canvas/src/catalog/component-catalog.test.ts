import { describe, expect, it } from 'bun:test';
import { COMPONENT_NAMES, componentCatalog } from './component-catalog.ts';

describe('componentCatalog', () => {
  it('exports the 24 catalog entries the design specifies', () => {
    const expected = [
      // shadcn-backed
      'Card',
      'Separator',
      'Tabs',
      'Accordion',
      'Badge',
      'Avatar',
      'Progress',
      'Skeleton',
      'Label',
      'Button',
      'Input',
      'Checkbox',
      'Switch',
      'Select',
      'Textarea',
      'Slider',
      // SeeFlow extras
      'Heading',
      'Text',
      'Icon',
      'Chart',
      'Table',
      'Metric',
      'CodeBlock',
      'Markdown',
    ];
    expect(COMPONENT_NAMES).toEqual(expect.arrayContaining(expected));
    expect(COMPONENT_NAMES.length).toBe(24);
  });

  it('every entry carries a Zod props schema', () => {
    for (const name of COMPONENT_NAMES) {
      const entry = componentCatalog.components[name];
      expect(entry, `missing catalog entry for ${name}`).toBeDefined();
      if (!entry) throw new Error(`unreachable: ${name}`);
      expect(typeof entry.props.safeParse).toBe('function');
    }
  });

  it('Button.props requires { label } and accepts an action ref', () => {
    const button = componentCatalog.components.Button;
    if (!button) throw new Error('Button entry missing');
    const ok = button.props.safeParse({ label: 'Go' });
    expect(ok.success).toBe(true);
    const withAction = button.props.safeParse({
      label: 'Go',
      onClick: { $action: 'submit' },
    });
    expect(withAction.success).toBe(true);
    const missing = button.props.safeParse({});
    expect(missing.success).toBe(false);
  });
});

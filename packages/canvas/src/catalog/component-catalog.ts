import { z } from 'zod';

// `$ref` shapes accepted in any prop slot. Resolved at render time by the
// json-render runtime — Zod here only enforces structural shape; path /
// action-name validity is enforced by superRefine in apps/studio/src/schema.ts.
const StateRef = z.object({ $state: z.string().min(1) });
const ActionRef = z.object({ $action: z.string().min(1) });
const CondRef = z.object({
  $cond: z.unknown(),
  $then: z.unknown(),
  $else: z.unknown().optional(),
});
const refOr = <T extends z.ZodTypeAny>(t: T) => z.union([t, StateRef, ActionRef, CondRef]);

const StringProp = refOr(z.string());
const NumberProp = refOr(z.number());
const BoolProp = refOr(z.boolean());

const PropsSchemas = {
  Card: z.object({ title: StringProp.optional() }),
  Separator: z.object({ orientation: refOr(z.enum(['horizontal', 'vertical'])).optional() }),
  Tabs: z.object({
    value: StringProp.optional(),
    items: z.array(z.object({ id: z.string(), label: z.string() })),
    onChange: ActionRef.optional(),
  }),
  Accordion: z.object({
    items: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
  }),
  Badge: z.object({
    label: StringProp,
    variant: refOr(z.enum(['default', 'secondary', 'destructive', 'outline'])).optional(),
  }),
  Avatar: z.object({
    src: StringProp.optional(),
    alt: StringProp.optional(),
    fallback: StringProp.optional(),
  }),
  Progress: z.object({ value: NumberProp }),
  Skeleton: z.object({ width: NumberProp.optional(), height: NumberProp.optional() }),
  Label: z.object({ text: StringProp }),
  Heading: z.object({
    level: refOr(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).optional(),
    text: StringProp,
  }),
  Text: z.object({ text: StringProp, muted: BoolProp.optional() }),
  Icon: z.object({ name: StringProp, size: NumberProp.optional() }),
  Chart: z.object({
    kind: refOr(z.enum(['bar', 'line', 'area', 'pie'])),
    data: refOr(z.array(z.record(z.string(), z.unknown()))),
    xKey: StringProp.optional(),
    series: z.array(z.object({ key: z.string(), label: z.string().optional() })).optional(),
  }),
  Table: z.object({
    columns: z.array(z.object({ key: z.string(), label: z.string() })),
    rows: refOr(z.array(z.record(z.string(), z.unknown()))),
  }),
  Metric: z.object({ label: StringProp, value: refOr(z.union([z.string(), z.number()])) }),
  CodeBlock: z.object({ code: StringProp, language: StringProp.optional() }),
  Markdown: z.object({ content: StringProp }),
  Button: z.object({
    label: StringProp,
    variant: refOr(
      z.enum(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']),
    ).optional(),
    onClick: ActionRef.optional(),
    disabled: BoolProp.optional(),
  }),
  Input: z.object({
    value: StringProp.optional(),
    placeholder: StringProp.optional(),
    onChange: ActionRef.optional(),
  }),
  Checkbox: z.object({
    checked: BoolProp.optional(),
    onChange: ActionRef.optional(),
    label: StringProp.optional(),
  }),
  Switch: z.object({ checked: BoolProp.optional(), onChange: ActionRef.optional() }),
  Select: z.object({
    value: StringProp.optional(),
    items: z.array(z.object({ value: z.string(), label: z.string() })),
    onChange: ActionRef.optional(),
  }),
  Textarea: z.object({
    value: StringProp.optional(),
    placeholder: StringProp.optional(),
    rows: NumberProp.optional(),
    onChange: ActionRef.optional(),
  }),
  Slider: z.object({
    value: NumberProp.optional(),
    min: NumberProp.optional(),
    max: NumberProp.optional(),
    step: NumberProp.optional(),
    onChange: ActionRef.optional(),
  }),
} as const;

export const COMPONENT_NAMES = Object.keys(PropsSchemas) as Array<keyof typeof PropsSchemas>;

export const componentCatalog = {
  components: Object.fromEntries(
    COMPONENT_NAMES.map((name) => [name, { props: PropsSchemas[name], description: name }]),
  ) as Record<string, { props: z.ZodTypeAny; description: string }>,
};

export type ComponentName = (typeof COMPONENT_NAMES)[number];

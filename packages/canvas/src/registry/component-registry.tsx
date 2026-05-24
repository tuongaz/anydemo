import { type ChangeEvent, type ComponentType, type ReactNode, Suspense, lazy } from 'react';
import { COMPONENT_NAMES } from '../catalog/component-catalog.ts';
import { cn } from '../lib/cn.ts';
import { Button as ButtonPrimitive } from '../ui/button.tsx';
import { Slider as SliderPrimitive } from '../ui/slider.tsx';
import { Heading } from './impls/heading.tsx';
import { Icon as IconImpl } from './impls/icon.tsx';
import { Metric } from './impls/metric.tsx';
import { Table as TableImpl } from './impls/table.tsx';
import { Text } from './impls/text.tsx';

/**
 * Catalog → React impl map consumed by ComponentRuntime.
 *
 * Eager primitives are shadcn-styled (Radix where available, plain HTML +
 * `sf:`-prefixed Tailwind otherwise). Heavy components (Chart / Markdown /
 * CodeBlock) are React.lazy-loaded so they don't enter the canvas's main
 * bundle until an author uses them.
 *
 * Adding a new catalog entry: add a key here AND extend the catalog. The
 * module-level assertion at the bottom of this file throws on load if the
 * two go out of sync.
 */
type ComponentImpl = ComponentType<Record<string, unknown> & { children?: ReactNode }>;

// --- shadcn-styled eager primitives ---------------------------------------

function Card({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sf:bg-card sf:p-4 sf:text-card-foreground sf:shadow-sm">
      {title !== undefined ? (
        <div className="sf:mb-3 sf:font-semibold sf:text-base sf:leading-tight">{title}</div>
      ) : null}
      <div className="sf:flex sf:flex-col sf:gap-3">{children}</div>
    </div>
  );
}

function Separator({ orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      aria-orientation={orientation}
      className={cn(
        'sf:bg-border',
        orientation === 'horizontal' ? 'sf:h-px sf:w-full' : 'sf:h-full sf:w-px',
      )}
    />
  );
}

interface TabItem {
  id: string;
  label: string;
}

function Tabs({
  value,
  items,
  onChange,
  children,
}: {
  value?: string;
  items?: TabItem[];
  onChange?: (payload: { value: string }) => void;
  children?: ReactNode;
}) {
  const list = items ?? [];
  return (
    <div className="sf:flex sf:flex-col sf:gap-2">
      <div className="sf:inline-flex sf:h-9 sf:items-center sf:justify-start sf:rounded-md sf:bg-muted sf:p-1 sf:text-muted-foreground">
        {list.map((item) => (
          <button
            key={item.id}
            type="button"
            data-state={value === item.id ? 'active' : 'inactive'}
            onClick={() => onChange?.({ value: item.id })}
            className="sf:inline-flex sf:items-center sf:justify-center sf:whitespace-nowrap sf:rounded-sm sf:px-3 sf:py-1 sf:text-xs sf:font-medium sf:transition-all sf:data-[state=active]:bg-background sf:data-[state=active]:text-foreground sf:data-[state=active]:shadow-sm"
          >
            {item.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

interface AccordionItemDef {
  id: string;
  title: string;
  content: string;
}

function Accordion({ items }: { items?: AccordionItemDef[] }) {
  const list = items ?? [];
  return (
    <div className="sf:flex sf:flex-col sf:divide-y sf:rounded-md sf:border">
      {list.map((item) => (
        <details key={item.id} className="sf:group sf:px-3 sf:py-2">
          <summary className="sf:cursor-pointer sf:py-1 sf:font-medium sf:text-sm">
            {item.title}
          </summary>
          <div className="sf:py-2 sf:text-muted-foreground sf:text-sm">{item.content}</div>
        </details>
      ))}
    </div>
  );
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const BADGE_VARIANT: Record<BadgeVariant, string> = {
  default: 'sf:bg-primary sf:text-primary-foreground',
  secondary: 'sf:bg-secondary sf:text-secondary-foreground',
  destructive: 'sf:bg-destructive sf:text-destructive-foreground',
  outline: 'sf:border sf:border-border sf:text-foreground',
};

function Badge({ label, variant = 'default' }: { label?: ReactNode; variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'sf:inline-flex sf:items-center sf:rounded-full sf:px-2.5 sf:py-0.5 sf:font-medium sf:text-xs',
        BADGE_VARIANT[variant] ?? BADGE_VARIANT.default,
      )}
    >
      {label}
    </span>
  );
}

function Avatar({ src, alt, fallback }: { src?: string; alt?: string; fallback?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? ''}
        className="sf:inline-block sf:h-9 sf:w-9 sf:rounded-full sf:object-cover"
      />
    );
  }
  return (
    <span className="sf:inline-flex sf:h-9 sf:w-9 sf:items-center sf:justify-center sf:rounded-full sf:bg-muted sf:font-medium sf:text-muted-foreground sf:text-sm">
      {fallback ?? '?'}
    </span>
  );
}

function Progress({ value = 0 }: { value?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className="sf:relative sf:h-2 sf:w-full sf:overflow-hidden sf:rounded-full sf:bg-secondary"
    >
      <div className="sf:h-full sf:bg-primary sf:transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}

function Skeleton({ width, height }: { width?: number; height?: number }) {
  return (
    <div
      className="sf:animate-pulse sf:rounded-md sf:bg-muted"
      style={{ width: width ?? '100%', height: height ?? 16 }}
    />
  );
}

function Label({ text }: { text?: ReactNode }) {
  // Rendered as a span (not <label>) because the catalog Label is a standalone
  // styled string in spec.json — there is no `for=` target to point at without
  // an explicit prop. Authors who want a real form label can wrap an Input in
  // Checkbox (which uses a real <label>) or build their own composition.
  return <span className="sf:font-medium sf:text-sm sf:leading-none">{text}</span>;
}

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';

function Button({
  label,
  variant = 'default',
  onClick,
  disabled,
}: {
  label?: ReactNode;
  variant?: ButtonVariant;
  onClick?: (payload?: unknown) => void;
  disabled?: boolean;
}) {
  return (
    <ButtonPrimitive variant={variant} disabled={disabled} onClick={() => onClick?.()}>
      {label}
    </ButtonPrimitive>
  );
}

const INPUT_CLASS =
  'sf:flex sf:h-9 sf:w-full sf:rounded-md sf:border sf:border-input sf:bg-background sf:px-3 sf:py-1 sf:text-sm sf:shadow-sm sf:transition-colors sf:placeholder:text-muted-foreground sf:focus-visible:outline-hidden sf:focus-visible:ring-1 sf:focus-visible:ring-ring sf:disabled:cursor-not-allowed sf:disabled:opacity-50';

function Input({
  value,
  placeholder,
  onChange,
}: {
  value?: string;
  placeholder?: string;
  onChange?: (payload: { value: string }) => void;
}) {
  return (
    <input
      type="text"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange?.({ value: e.target.value })}
      className={INPUT_CLASS}
    />
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked?: boolean;
  onChange?: (payload: { checked: boolean }) => void;
  label?: ReactNode;
}) {
  return (
    <label className="sf:inline-flex sf:items-center sf:gap-2 sf:text-sm">
      <input
        type="checkbox"
        checked={checked ?? false}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange?.({ checked: e.target.checked })}
        className="sf:h-4 sf:w-4 sf:rounded sf:border sf:border-input sf:accent-primary"
      />
      {label}
    </label>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked?: boolean;
  onChange?: (payload: { checked: boolean }) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ?? false}
      onClick={() => onChange?.({ checked: !(checked ?? false) })}
      className={cn(
        'sf:relative sf:inline-flex sf:h-5 sf:w-9 sf:shrink-0 sf:cursor-pointer sf:items-center sf:rounded-full sf:border-2 sf:border-transparent sf:transition-colors',
        checked ? 'sf:bg-primary' : 'sf:bg-input',
      )}
    >
      <span
        className={cn(
          'sf:pointer-events-none sf:block sf:h-4 sf:w-4 sf:rounded-full sf:bg-background sf:shadow-lg sf:ring-0 sf:transition-transform',
          checked ? 'sf:translate-x-4' : 'sf:translate-x-0',
        )}
      />
    </button>
  );
}

interface SelectItem {
  value: string;
  label: string;
}

function Select({
  value,
  items,
  onChange,
}: {
  value?: string;
  items?: SelectItem[];
  onChange?: (payload: { value: string }) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange?.({ value: e.target.value })}
      className={INPUT_CLASS}
    >
      {(items ?? []).map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

function Textarea({
  value,
  placeholder,
  rows,
  onChange,
}: {
  value?: string;
  placeholder?: string;
  rows?: number;
  onChange?: (payload: { value: string }) => void;
}) {
  return (
    <textarea
      value={value ?? ''}
      placeholder={placeholder}
      rows={rows}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange?.({ value: e.target.value })}
      className={cn(INPUT_CLASS, 'sf:min-h-16 sf:py-2')}
    />
  );
}

function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (payload: { value: number }) => void;
}) {
  return (
    <SliderPrimitive
      value={value === undefined ? undefined : [value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => {
        const [head] = next;
        if (typeof head === 'number') onChange?.({ value: head });
      }}
    />
  );
}

// --- Lazy heavy impls -----------------------------------------------------
//
// Each lazy chunk is wrapped in <Suspense> so the runtime — which has no
// Suspense boundary of its own — can mount the lazy component without
// React throwing.

const LazyChart = lazy(() => import('./impls/chart.tsx'));
function Chart(props: Record<string, unknown>) {
  return (
    <Suspense fallback={null}>
      <LazyChart {...(props as Parameters<typeof LazyChart>[0])} />
    </Suspense>
  );
}

const LazyMarkdown = lazy(() => import('./impls/markdown.tsx'));
function Markdown(props: Record<string, unknown>) {
  return (
    <Suspense fallback={null}>
      <LazyMarkdown {...(props as Parameters<typeof LazyMarkdown>[0])} />
    </Suspense>
  );
}

const LazyCodeBlock = lazy(() => import('./impls/code-block.tsx'));
function CodeBlock(props: Record<string, unknown>) {
  return (
    <Suspense fallback={null}>
      <LazyCodeBlock {...(props as Parameters<typeof LazyCodeBlock>[0])} />
    </Suspense>
  );
}

// --- Registry --------------------------------------------------------------

const components: Record<string, ComponentImpl> = {
  Card: Card as ComponentImpl,
  Separator: Separator as ComponentImpl,
  Tabs: Tabs as ComponentImpl,
  Accordion: Accordion as ComponentImpl,
  Badge: Badge as ComponentImpl,
  Avatar: Avatar as ComponentImpl,
  Progress: Progress as ComponentImpl,
  Skeleton: Skeleton as ComponentImpl,
  Label: Label as ComponentImpl,
  Heading: Heading as ComponentImpl,
  Text: Text as ComponentImpl,
  Icon: IconImpl as ComponentImpl,
  Chart: Chart as ComponentImpl,
  Table: TableImpl as ComponentImpl,
  Metric: Metric as ComponentImpl,
  CodeBlock: CodeBlock as ComponentImpl,
  Markdown: Markdown as ComponentImpl,
  Button: Button as ComponentImpl,
  Input: Input as ComponentImpl,
  Checkbox: Checkbox as ComponentImpl,
  Switch: Switch as ComponentImpl,
  Select: Select as ComponentImpl,
  Textarea: Textarea as ComponentImpl,
  Slider: Slider as ComponentImpl,
};

const missing = COMPONENT_NAMES.filter((name) => components[name] === undefined);
if (missing.length > 0) {
  throw new Error(
    `componentRegistry is missing impls for: ${missing.join(', ')}. Every catalog entry in COMPONENT_NAMES must have a matching component impl.`,
  );
}

export const componentRegistry: { components: Record<string, ComponentImpl> } = { components };

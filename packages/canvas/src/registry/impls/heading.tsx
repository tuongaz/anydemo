import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

interface HeadingProps {
  text?: ReactNode;
  level?: 1 | 2 | 3 | 4;
}

const LEVEL_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'sf:text-2xl sf:font-semibold sf:tracking-tight',
  2: 'sf:text-xl sf:font-semibold sf:tracking-tight',
  3: 'sf:text-lg sf:font-semibold',
  4: 'sf:text-base sf:font-semibold',
};

export function Heading({ text, level = 2 }: HeadingProps) {
  const Tag = `h${level}` as const as 'h1' | 'h2' | 'h3' | 'h4';
  return <Tag className={cn(LEVEL_CLASS[level])}>{text}</Tag>;
}

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

interface TextProps {
  text?: ReactNode;
  muted?: boolean;
}

export function Text({ text, muted }: TextProps) {
  return <p className={cn('sf:text-sm', muted && 'sf:text-muted-foreground')}>{text}</p>;
}

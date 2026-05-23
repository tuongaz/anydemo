import { Icon as IconPrimitive } from '../../ui/icon.tsx';

interface IconProps {
  name?: string;
  size?: number;
}

export function Icon({ name, size = 16 }: IconProps) {
  return <IconPrimitive name={name} size={size} aria-hidden />;
}

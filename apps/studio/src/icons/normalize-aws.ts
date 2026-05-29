const STRIP_PREFIXES = ['Arch_AWS-', 'Arch_Amazon-', 'Arch-Category_', 'Arch_'];
const SIZE_SUFFIX = /_(?:16|32|48|64)$/;

export function canonicalAwsName(filename: string): string | null {
  if (!filename.toLowerCase().endsWith('.svg')) return null;
  let base = filename.slice(0, -'.svg'.length);
  for (const prefix of STRIP_PREFIXES) {
    if (base.startsWith(prefix)) {
      base = base.slice(prefix.length);
      break;
    }
  }
  base = base.replace(SIZE_SUFFIX, '');
  const kebab = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return kebab.length > 0 ? kebab : null;
}

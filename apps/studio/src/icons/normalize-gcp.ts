export function canonicalGcpName(filename: string): string | null {
  if (!filename.toLowerCase().endsWith('.svg')) return null;
  const base = filename.slice(0, -'.svg'.length);
  const kebab = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return kebab.length > 0 ? kebab : null;
}

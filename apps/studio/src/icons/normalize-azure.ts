export function canonicalAzureName(filename: string): string | null {
  if (!filename.toLowerCase().endsWith('.svg')) return null;
  let base = filename.slice(0, -'.svg'.length);
  base = base.replace(/^\d+-icon-service-/i, '');
  base = base.replace(/^icon-service-/i, '');
  const kebab = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return kebab.length > 0 ? kebab : null;
}

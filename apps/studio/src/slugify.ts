// URL- and folder-safe slug conversion. Used by the registry, the project
// scanner, and CLI verbs whenever a human-readable name needs to become a
// stable identifier on disk or in a URL.
//
// Rules:
//   - lowercase
//   - any run of non-alphanumeric characters collapses to a single dash
//   - leading + trailing dashes are stripped
//   - empty result falls back to `'flow'` so callers always get a usable slug
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'flow';
}

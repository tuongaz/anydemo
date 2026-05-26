// URL- and folder-safe slug conversion for in-browser use (FlowCreateDialog's
// derive-id-from-name behavior). Mirrors apps/studio/src/slugify.ts so the
// id the dialog suggests matches what the studio would compute server-side.
//
// Rules:
//   - lowercase
//   - any run of non-alphanumeric characters collapses to a single dash
//   - leading + trailing dashes are stripped
//   - empty result returns '' (NOT the studio's 'demo' sentinel — the dialog
//     wants an empty hint when the user has typed only punctuation, so the
//     name input doesn't auto-fill the id with the literal string 'demo')
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

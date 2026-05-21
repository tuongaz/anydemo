const NANO_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function nanoid(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += NANO_ALPHABET[Math.floor(Math.random() * NANO_ALPHABET.length)];
  }
  return out;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'flow'
  );
}

export function uniqueFlowId(testName: string): string {
  return `it-${slug(testName)}-${nanoid(6)}`;
}

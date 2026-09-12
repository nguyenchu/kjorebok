/** Norwegian plates: two letters then five digits, e.g. "AB 12345". */
export const REGISTRATION_PATTERN = /^[A-ZÆØÅ]{2}\s?\d{5}$/;

export function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

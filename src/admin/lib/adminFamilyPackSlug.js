/**
 * Matches server `normalizeFamilyPackSlug` for client-side suggestions.
 * @param {string} raw
 */
export function suggestFamilyPackSlugFromName(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

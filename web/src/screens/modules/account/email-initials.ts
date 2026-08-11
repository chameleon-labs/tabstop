/**
 * Up to two initials for an email address.
 *
 * Lattice's own rule splits on whitespace, which is right for a person's name
 * and wrong for an address: `ada.lovelace@` is one word to it. The account
 * carries no name, so this feeds the `initials` escape hatch instead.
 */
export const emailInitials = (email: string): string => {
  const [local = ''] = email.split('@');
  const [untagged = ''] = local.split('+');
  const words = untagged.split(/[._-]+/).filter(Boolean);

  if (words.length === 0) {
    return '?';
  }

  // Code points, not UTF-16 units, or an astral character loses half of itself.
  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : '';

  // Cased without a locale: `toLocaleUpperCase` turns `i` into `İ` on a Turkish
  // host, so the same address would render differently there.
  return `${first}${last}`.toUpperCase();
};

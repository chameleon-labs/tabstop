export const emailInitials = (email: string): string => {
  const [local = ''] = email.split('@');
  const [untagged = ''] = local.split('+');
  const words = untagged.split(/[._-]+/).filter(Boolean);

  if (words.length === 0) {
    return '?';
  }

  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : '';

  return `${first}${last}`.toUpperCase();
};

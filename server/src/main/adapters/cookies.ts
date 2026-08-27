export const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = Object.create(null);
  if (header === undefined) {
    return cookies;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === '') {
      continue;
    }
    if (name in cookies) {
      continue;
    }
    cookies[name] = part.slice(separator + 1).trim();
  }

  return cookies;
};

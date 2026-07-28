/**
 * Express 5 writes cookies but cannot read them: res.cookie() is core, req.cookies
 * is not - core ships no parser. Rather than take on cookie-parser for one
 * cookie, parse the header here. The session id is hex, so the percent-decoding
 * question a general parser exists to answer never arises.
 */
export const parseCookies = (header: string | undefined): Record<string, string> => {
  // Null prototype: every name here is client-controlled and used as a key
  // immediately, so `__proto__`, `constructor` and `toString` must be ordinary
  // entries rather than things with meaning.
  const cookies: Record<string, string> = Object.create(null)
  if (header === undefined) return cookies

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (name === '') continue
    // FIRST wins. RFC 6265 orders the header most-specific-first, so the first
    // value is the one the browser considers the closest match - and a second
    // cookie of the same name is not a typo, it is an attempt to replace a
    // session. `__Host-` is what puts that out of reach in production; the
    // parser should not be the weak link everywhere else.
    if (name in cookies) continue
    cookies[name] = part.slice(separator + 1).trim()
  }

  return cookies
}

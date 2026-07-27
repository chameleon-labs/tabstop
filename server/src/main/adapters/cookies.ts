/**
 * Express 5 writes cookies but cannot read them: res.cookie() is core, req.cookies
 * is not - core ships no parser. Rather than take on cookie-parser for one
 * cookie, parse the header here. The session id is hex, so the percent-decoding
 * question a general parser exists to answer never arises.
 */
export const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {}
  if (header === undefined) return cookies

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (name === '') continue
    cookies[name] = part.slice(separator + 1).trim()
  }

  return cookies
}

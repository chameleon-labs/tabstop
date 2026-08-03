import { describe, expect, it } from 'vitest'
import { URL_PROBLEMS, normaliseUrl } from './url'

const urlOf = (raw: string): string => {
  const result = normaliseUrl(raw)
  if (!result.ok) throw new Error(`expected ${raw} to normalise, got ${result.problem}`)
  return result.url
}

describe('normaliseUrl', () => {
  describe('being forgiving about what someone types', () => {
    it('adds https to a bare domain', () => {
      // The single most common input. Demanding a scheme is a form asking a
      // person to do something the machine can do.
      expect(urlOf('example.com')).toBe('https://example.com/')
    })

    it('ignores surrounding whitespace, which a paste brings with it', () => {
      expect(urlOf('  example.com \n')).toBe('https://example.com/')
    })

    it('keeps a path, query and fragment', () => {
      expect(urlOf('example.com/pricing?plan=team#faq'))
        .toBe('https://example.com/pricing?plan=team#faq')
    })

    it('lowercases the host but not the path, as a URL should', () => {
      expect(urlOf('Example.COM/Pricing')).toBe('https://example.com/Pricing')
    })

    it('leaves an explicit http alone rather than upgrading it', () => {
      // Someone who typed `http://` meant it. Auditing https instead would
      // audit a different page than the one shown back to them - and on many
      // sites a genuinely different page.
      expect(urlOf('http://example.com')).toBe('http://example.com/')
    })

    it('keeps a port', () => {
      expect(urlOf('example.com:8080/health')).toBe('https://example.com:8080/health')
    })

    it('returns the canonical form, which is also what gets displayed', () => {
      // Showing one string and submitting another is how "why does the result
      // say example.com/ when I typed example.com" happens.
      expect(urlOf('example.com')).toBe('https://example.com/')
    })
  })

  describe('the two things it refuses', () => {
    it.each(['', '   ', '\t\n'])('refuses %p as empty', (raw) => {
      expect(normaliseUrl(raw)).toEqual({ ok: false, problem: 'empty' })
    })

    it.each([
      ['javascript:alert(1)', 'a scheme that names no page'],
      ['mailto:someone@example.com', 'an address rather than a page'],
      ['https://', 'a scheme and nothing else']
    ])('refuses %p - %s', (raw) => {
      expect(normaliseUrl(raw)).toEqual({ ok: false, problem: 'unparseable' })
    })

    it('has a message for each problem it reports', () => {
      // The only two sentences this package writes. Everything else is quoted
      // from the server, which owns the policy that produced it.
      expect(Object.keys(URL_PROBLEMS).sort()).toEqual(['empty', 'unparseable'])
      for (const message of Object.values(URL_PROBLEMS)) expect(message).not.toBe('')
    })
  })

  describe('what it deliberately does NOT judge', () => {
    it('passes a non-http scheme through for the server to refuse', () => {
      // The server has one table of rejection messages, with a comment about
      // why there must be exactly one: a submission-time rejection and an
      // audit-time one must read identically, or the difference reveals which
      // internal addresses exist. A second copy here would erode that from a
      // package the server cannot see.
      expect(urlOf('ftp://example.com')).toBe('ftp://example.com/')
    })

    it('passes a private address through rather than deciding policy', () => {
      expect(urlOf('192.168.0.1')).toBe('https://192.168.0.1/')
      expect(urlOf('localhost:3000')).toBe('https://localhost:3000/')
    })

    it('passes embedded credentials through', () => {
      expect(urlOf('https://user:pw@example.com')).toBe('https://user:pw@example.com/')
    })

    it('accepts a hostname with no dot, leaving DNS to say so', () => {
      // `exampl` is a typo the server answers with "Could not resolve that
      // domain". Rejecting it here would also reject `localhost`, and inventing
      // a hostname rule is how a client starts disagreeing with its server.
      expect(urlOf('exampl')).toBe('https://exampl/')
    })
  })
})

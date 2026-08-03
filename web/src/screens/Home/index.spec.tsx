import type { AuditResultResponse } from '@tabstop/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '../../test/http'
import { renderAt } from '../../test/render'

const auditBody = (over: Partial<AuditResultResponse> = {}): AuditResultResponse => ({
  auditId: 'abc', url: 'https://example.com/', status: 'done',
  createdAt: '2026-08-03T09:00:00.000Z', completedAt: '2026-08-03T09:00:30.000Z',
  score: 72, countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 1 },
  axeVersion: '4.12.1', settled: true, error: null,
  violations: [{
    ruleId: 'image-alt', impact: 'critical', description: 'Images need alt text',
    helpUrl: 'https://example.test', nodes: [{ target: ['img'], html: '<img src=x>' }]
  }],
  ...over
})

/**
 * Routed by method, because this screen drives two endpoints in sequence and a
 * single canned response cannot express "accepted, then still running, then
 * done" - which is the only interesting shape this screen has.
 */
const server = (
  handlers: { post?: () => Response, get?: () => Response }
): ReturnType<typeof vi.fn> => {
  const mock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? handlers.post?.() ??
        jsonResponse(202, { auditId: 'abc', status: 'queued', pollAfterMs: 20 })
      : handlers.get?.() ?? jsonResponse(200, auditBody())
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

const submit = async (raw: string): Promise<void> => {
  await userEvent.type(screen.getByLabelText('Page to audit'), `${raw}{Enter}`)
}

describe('the home screen', () => {
  beforeEach(() => { server({}) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('leads with what the product does', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Paste a URL')
  })

  it('is the site itself, so the tab says only the site name', () => {
    renderAt('/')

    expect(document.title).toBe('tabstop')
  })

  it('takes a bare domain through to a result', async () => {
    // The whole hook, end to end: paste, wait, get something worth sharing.
    renderAt('/')

    await submit('example.com')

    expect(await screen.findByRole('heading', { level: 2, name: /Result for/ })).toBeVisible()
    expect(screen.getByText('72')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Images need alt text' })).toBeVisible()
  })

  it('submits the normalised URL, not the typed one', async () => {
    const fetchMock = server({})
    renderAt('/')

    await submit('example.com')

    await waitFor(() => { expect(fetchMock).toHaveBeenCalled() })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe('{"url":"https://example.com/"}')
  })

  it('shows progress while running, and nothing else once done', async () => {
    let status: AuditResultResponse['status'] = 'running'
    server({ get: () => jsonResponse(200, auditBody({ status })) })
    renderAt('/')

    await submit('example.com')
    const heading = await screen.findByRole('heading', { level: 2, name: 'Auditing' })

    // Scoped to the progress section: the shell carries its own polite region
    // for route announcements, and two independent live regions on a page is
    // correct rather than a conflict - they never speak about the same thing.
    const section = heading.closest('section') as HTMLElement
    expect(within(section).getByRole('status')).toHaveTextContent(/about 30 seconds/)

    status = 'done'

    // Mutually exclusive: progress still showing beneath a result reads as
    // though the result were stale.
    expect(await screen.findByRole('heading', { level: 2, name: /Result for/ })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Auditing' })).not.toBeInTheDocument()
  })

  it('will not accept a second URL while one is running', async () => {
    server({ get: () => jsonResponse(200, auditBody({ status: 'running' })) })
    renderAt('/')

    await submit('example.com')

    await waitFor(() => { expect(screen.getByLabelText('Page to audit')).toBeDisabled() })
  })

  describe('failure states, each distinct', () => {
    it("sends a rejected address back to the URL, with the server's reason", async () => {
      server({ post: () => jsonResponse(400, { error: "That address can't be audited" }) })
      renderAt('/')

      await submit('192.168.0.1')

      expect(await screen.findByText("That address can't be audited")).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('turns the rate limit into a signup offer rather than an error', async () => {
      server({
        post: () => jsonResponse(429, {
          error: 'Too many requests', retryAfter: 45, resetAt: '2026-08-03T10:00:00.000Z'
        })
      })
      renderAt('/')

      await submit('example.com')

      expect(await screen.findByRole('heading', { name: 'You have used your free audits' }))
        .toBeVisible()
      expect(screen.getByRole('link', { name: 'Create an account' })).toBeVisible()
    })

    it('offers a retry when the audit itself failed', async () => {
      server({
        get: () => jsonResponse(200, auditBody({
          status: 'failed', error: 'The page took too long to load', score: null, violations: []
        }))
      })
      renderAt('/')

      await submit('example.com')

      expect(await screen.findByText('The page took too long to load')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    })

    it('re-runs the same URL on retry, without asking for it again', async () => {
      const fetchMock = server({
        post: () => jsonResponse(503, { error: 'Could not queue that audit, please try again' })
      })
      renderAt('/')
      await submit('example.com')
      await screen.findByRole('button', { name: 'Try again' })

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      await waitFor(() => {
        const posts = fetchMock.mock.calls.filter(
          (call) => (call[1] as RequestInit | undefined)?.method === 'POST'
        )
        expect(posts.length).toBeGreaterThan(1)
        expect((posts.at(-1)?.[1] as RequestInit).body).toBe('{"url":"https://example.com/"}')
      })
    })

    it('never shows a result alongside a failure', async () => {
      server({ get: () => jsonResponse(200, auditBody({ status: 'failed', error: 'boom' })) })
      renderAt('/')

      await submit('example.com')

      await screen.findByText('boom')
      expect(screen.queryByRole('heading', { name: /Result for/ })).not.toBeInTheDocument()
    })
  })

  it('is completable with the keyboard alone', async () => {
    // An accessibility product whose own hook needs a mouse is not shippable.
    renderAt('/')

    const field = screen.getByLabelText('Page to audit')
    for (let tabs = 0; tabs < 8 && document.activeElement !== field; tabs += 1) {
      await userEvent.tab()
    }
    expect(field).toHaveFocus()

    await userEvent.keyboard('example.com{Enter}')

    expect(await screen.findByRole('heading', { level: 2, name: /Result for/ })).toBeVisible()
  })
})

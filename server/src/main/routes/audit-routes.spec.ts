import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'express'

const makeRouter = () => ({
  post: vi.fn(),
  get: vi.fn()
})

/**
 * Loaded through a stubbed env so the flag can be flipped, which a normal
 * import cannot do: env.ts parses once at module load.
 */
const setupWith = async (auditApiEnabled: boolean, router: ReturnType<typeof makeRouter>) => {
  vi.resetModules()
  vi.doMock('../config/env.js', () => ({ env: { auditApiEnabled } }))
  const { default: setupAuditRoutes } = await import('./audit-routes.js')
  setupAuditRoutes(router as unknown as Router)
}

describe('audit routes', () => {
  afterEach(() => {
    vi.doUnmock('../config/env.js')
    vi.resetModules()
  })

  it('registers nothing unless the endpoints are explicitly enabled', async () => {
    // The endpoints are anonymous and unrated-limited until #8, and each
    // accepted request costs roughly thirty seconds of Chromium. A comment
    // cannot prevent a deploy - an absent route can, and this is what makes
    // that mechanical rather than documented.
    const router = makeRouter()

    await setupWith(false, router)

    expect(router.post).not.toHaveBeenCalled()
    expect(router.get).not.toHaveBeenCalled()
  })

  // The enabled path is not asserted here: building the controllers reaches
  // for a database connection, and it is already proven end to end by
  // audit-routes.test.ts, which registers both endpoints and exercises them.
})

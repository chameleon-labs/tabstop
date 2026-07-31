import { describe, expect, it } from 'vitest'
import { AlertUnsubscribeConfirmationController } from './alert-unsubscribe-confirmation-controller.js'

describe('AlertUnsubscribeConfirmationController', () => {
  it('renders a safe confirmation form without changing state', async () => {
    const response = await new AlertUnsubscribeConfirmationController().handle({
      token: 'v1.42.signature'
    })

    expect(response).toMatchObject({ statusCode: 200, bodyType: 'html' })
    expect(response.body).toContain('action="/api/alerts/unsubscribe/v1.42.signature"')
    expect(response.body).toContain('name="List-Unsubscribe" value="One-Click"')
  })

  it('escapes an untrusted path segment before putting it in HTML', async () => {
    const response = await new AlertUnsubscribeConfirmationController().handle({
      token: '"><script>alert(1)</script>'
    })

    expect(response.body).not.toContain('<script>')
    expect(response.body).toContain('&quot;&gt;&lt;script&gt;')
  })
})

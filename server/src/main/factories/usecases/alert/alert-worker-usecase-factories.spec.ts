import { describe, expect, it } from 'vitest'
import * as factories from './alert-worker-usecase-factories.js'

describe('alert worker use-case factories', () => {
  it('maps console previews and Resend delivery to their dispatch modes', () => {
    const alertDispatchMode = Reflect.get(factories, 'alertDispatchMode')

    expect(alertDispatchMode).toEqual(expect.any(Function))
    expect(Reflect.apply(alertDispatchMode, undefined, ['console'])).toBe('preview')
    expect(Reflect.apply(alertDispatchMode, undefined, ['resend'])).toBe('delivery')
  })
})

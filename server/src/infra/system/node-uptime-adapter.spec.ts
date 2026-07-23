import { describe, expect, it } from 'vitest'
import { NodeUptimeAdapter } from './node-uptime-adapter.js'

describe('NodeUptimeAdapter', () => {
  it('returns a non-negative uptime in seconds', () => {
    const sut = new NodeUptimeAdapter()

    const uptime = sut.getUptimeInSeconds()

    expect(uptime).toBeGreaterThanOrEqual(0)
  })
})

import { describe, expect, it } from 'vitest'
import { HealthCheckUseCase } from './health-check.js'
import { mockUptimeProvider } from '../../test/mock-uptime-provider.js'

const makeSut = () => {
  const uptimeProvider = mockUptimeProvider()
  const sut = new HealthCheckUseCase(uptimeProvider)
  return { sut, uptimeProvider }
}

describe('HealthCheckUseCase', () => {
  it('returns status up with the uptime from UptimeProvider', async () => {
    const { sut, uptimeProvider } = makeSut()

    const result = await sut.check()

    expect(result.status).toBe('up')
    expect(result.uptimeInSeconds).toBe(uptimeProvider.getUptimeInSeconds())
  })

  it('returns a checkedAt timestamp close to now', async () => {
    const { sut } = makeSut()

    const before = Date.now()
    const result = await sut.check()
    const after = Date.now()

    const checkedAt = new Date(result.checkedAt).getTime()
    expect(checkedAt).toBeGreaterThanOrEqual(before)
    expect(checkedAt).toBeLessThanOrEqual(after)
  })
})

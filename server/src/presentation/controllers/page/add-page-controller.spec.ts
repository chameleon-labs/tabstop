import { describe, expect, it } from 'vitest'
import { AddPageController, type AddPageBody } from './add-page-controller.js'
import { mockAddPage, mockPageModel, mockValidation } from '../../test/index.js'

const makeSut = (url = 'https://example.test/pricing') => {
  const validation = mockValidation<AddPageBody>({ url })
  const addPage = mockAddPage()
  return { sut: new AddPageController(validation, addPage), validation, addPage }
}

describe('AddPageController', () => {
  it('returns 201 with the page and the audit the client should poll', async () => {
    const { sut, addPage } = makeSut()

    const response = await sut.handle({ userId: 'user-1' })

    expect(addPage.add).toHaveBeenCalledWith({
      userId: 'user-1', url: 'https://example.test/pricing'
    })
    expect(response.statusCode).toBe(201)
    expect(response.body).toEqual({
      id: 'any-page-id',
      url: 'https://example.test/pricing',
      monitoringEnabled: true,
      createdAt: '2026-07-29T10:00:00.000Z',
      firstAuditId: '22222222-2222-2222-2222-222222222222'
    })
  })

  it('never puts the site id on the wire', async () => {
    // siteId names a grouping that belongs to the account. A client has no use
    // for it, and a spread of the model is how it would arrive.
    const { sut } = makeSut()

    expect(JSON.stringify((await sut.handle({ userId: 'user-1' })).body))
      .not.toContain(mockPageModel().siteId)
  })

  it('reports a null audit id when the queue would not take the job', async () => {
    const { sut, addPage } = makeSut()
    addPage.add.mockResolvedValueOnce({
      outcome: 'added', page: mockPageModel(), firstAuditId: null
    })

    const response = await sut.handle({ userId: 'user-1' })

    expect(response.statusCode).toBe(201)
    expect(response.body).toMatchObject({ firstAuditId: null })
  })

  it('returns 400 with the shared wording for a rejected url', async () => {
    const { sut, addPage } = makeSut()
    addPage.add.mockResolvedValueOnce({ outcome: 'rejected', reason: 'blocked-address' })

    const response = await sut.handle({ userId: 'user-1' })

    expect(response.statusCode).toBe(400)
    // Identical to what the worker says about an address it refuses at fetch
    // time. A difference would tell an attacker which internal hosts exist.
    expect(response.body).toEqual({ error: "That address can't be audited" })
  })

  it('returns 400 when validation rejects the body', async () => {
    const { sut, validation, addPage } = makeSut()
    validation.validate.mockReturnValueOnce({ error: new Error('url: Required') })

    const response = await sut.handle({ userId: 'user-1' })

    expect(response.statusCode).toBe(400)
    expect(addPage.add).not.toHaveBeenCalled()
  })

  it('returns a coded 409 carrying the limit when the account is full', async () => {
    const { sut, addPage } = makeSut()
    addPage.add.mockResolvedValueOnce({ outcome: 'limit-reached', limit: 10 })

    const response = await sut.handle({ userId: 'user-1' })

    expect(response.statusCode).toBe(409)
    // The code is what the dashboard branches on to render an upsell rather
    // than a wall; `error` stays the sentence, as on every other endpoint.
    expect(response.body).toEqual({
      code: 'page_limit_reached',
      limit: 10,
      error: "You're already tracking 10 pages, the maximum during the beta"
    })
  })

  it('distinguishes an already-tracked page from a full account', async () => {
    const { sut, addPage } = makeSut()
    addPage.add.mockResolvedValueOnce({ outcome: 'duplicate' })

    const response = await sut.handle({ userId: 'user-1' })

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({
      code: 'page_already_tracked',
      error: 'You are already tracking that page'
    })
  })

  it('returns 500 without leaking the failure when the usecase throws', async () => {
    const { sut, addPage } = makeSut()
    addPage.add.mockRejectedValueOnce(new Error('connection terminated unexpectedly'))

    const response = await sut.handle({ userId: 'user-1' })

    expect(response.statusCode).toBe(500)
    expect(JSON.stringify(response.body)).not.toContain('connection terminated')
  })
})

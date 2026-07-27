import { describe, expect, it } from 'vitest'
import { SignupController } from './signup-controller.js'
import { mockAccountModel, mockAddAccount, mockValidation } from '../../test/mock-account.js'

const request = { email: 'a@b.co', password: 'correct horse battery staple' }

const makeSut = () => {
  const validation = mockValidation(request)
  const addAccount = mockAddAccount()
  const sut = new SignupController(validation, addAccount, 'sid')
  return { sut, validation, addAccount }
}

describe('SignupController', () => {
  it('returns 201 with the account view and a session cookie', async () => {
    const { sut } = makeSut()

    const response = await sut.handle(request)

    expect(response.statusCode).toBe(201)
    expect(response.body).toEqual({
      id: 'any-user-id', email: 'any@example.test', alertThreshold: 5
    })
    expect(response.cookies).toEqual([{
      action: 'set',
      name: 'sid',
      value: 'any-session-id',
      // Taken from the persisted session, so the cookie cannot outlive the row.
      expiresAt: new Date('2026-08-25T00:00:00Z')
    }])
  })

  it('never exposes createdAt or a digest in the response', async () => {
    const { sut } = makeSut()

    const response = await sut.handle(request)

    expect(response.body).not.toHaveProperty('createdAt')
    expect(JSON.stringify(response.body)).not.toContain('digest')
  })

  it('returns 400 without calling the usecase when validation fails', async () => {
    const { sut, validation, addAccount } = makeSut()
    validation.validate.mockReturnValueOnce({ error: new Error('email: Invalid email address') })

    const response = await sut.handle({})

    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual({ error: 'email: Invalid email address' })
    expect(addAccount.add).not.toHaveBeenCalled()
  })

  it('returns 409 when the email is already registered', async () => {
    // 409 rather than the reference template's 403: 403 means "we know who you
    // are and you may not", and signup is unauthenticated.
    const { sut, addAccount } = makeSut()
    addAccount.add.mockResolvedValueOnce(null)

    const response = await sut.handle(request)

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({ error: 'This email is already registered' })
    expect(response.cookies).toBeUndefined()
  })

  it('returns 500 when the usecase throws', async () => {
    const { sut, addAccount } = makeSut()
    addAccount.add.mockRejectedValueOnce(new Error('database down'))

    const response = await sut.handle(request)

    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual({ error: 'Internal server error' })
  })

  it('passes the validated data to the usecase, not the raw request', async () => {
    const { sut, validation, addAccount } = makeSut()
    validation.validate.mockReturnValueOnce({
      data: { email: 'normalised@b.co', password: 'x'.repeat(12) }
    })

    await sut.handle({ email: '  NORMALISED@B.CO  ', password: 'x'.repeat(12) })

    expect(addAccount.add).toHaveBeenCalledWith({
      email: 'normalised@b.co', password: 'x'.repeat(12)
    })
  })
})

import type { AccountModel } from '../../../domain/models/account.js'
import type { AuthenticatedSession } from '../../../domain/models/session.js'
import type { StartSession } from '../../../domain/usecases/start-session.js'
import type { SessionIdGenerator } from '../../protocols/cryptography/session-id-generator.js'
import type { AddSessionRepository } from '../../protocols/db/session/add-session-repository.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export class DbStartSession implements StartSession {
  constructor (
    private readonly sessionIdGenerator: SessionIdGenerator,
    private readonly addSessionRepository: AddSessionRepository,
    private readonly ttlDays: number
  ) {}

  async start (account: AccountModel): Promise<AuthenticatedSession> {
    const id = this.sessionIdGenerator.generate()
    const expiresAt = new Date(Date.now() + this.ttlDays * MS_PER_DAY)

    const session = await this.addSessionRepository.add({ id, userId: account.id, expiresAt })

    // expiresAt comes back from the stored row, so the cookie and the session
    // cannot disagree about when it dies.
    return { account, sessionId: session.id, expiresAt: session.expiresAt }
  }
}

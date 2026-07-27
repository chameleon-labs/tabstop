import type { AccountModel } from '../../../domain/models/account.js'
import type { LoadAccountBySession } from '../../../domain/usecases/load-account-by-session.js'
import type {
  LoadAccountBySessionIdRepository
} from '../../protocols/db/account/load-account-by-session-id-repository.js'

export class DbLoadAccountBySession implements LoadAccountBySession {
  constructor (
    private readonly loadAccountBySessionIdRepository: LoadAccountBySessionIdRepository
  ) {}

  async load (sessionId: string): Promise<AccountModel | null> {
    return await this.loadAccountBySessionIdRepository.loadBySessionId(sessionId)
  }
}

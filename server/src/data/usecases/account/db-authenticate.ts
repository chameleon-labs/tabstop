import type { AuthenticatedSession } from '../../../domain/models/session.js'
import type { Authenticate, AuthenticateParams } from '../../../domain/usecases/authenticate.js'
import type { StartSession } from '../../../domain/usecases/start-session.js'
import type { Hasher } from '../../protocols/cryptography/hasher.js'
import type { HashComparer } from '../../protocols/cryptography/hash-comparer.js'
import type {
  LoadAccountByEmailRepository
} from '../../protocols/db/account/load-account-by-email-repository.js'

export class DbAuthenticate implements Authenticate {
  private dummyDigest: Promise<string> | null = null

  constructor (
    private readonly loadAccountByEmailRepository: LoadAccountByEmailRepository,
    private readonly hasher: Hasher,
    private readonly hashComparer: HashComparer,
    private readonly startSession: StartSession
  ) {}

  /**
   * Hashed once, lazily, at the same cost as a real digest. Without it an
   * unknown email returns in ~0ms and a known one in ~89ms, and the deliberate
   * choice to return one identical error for both cases is undone by a
   * stopwatch.
   */
  private async getDummyDigest (): Promise<string> {
    this.dummyDigest ??= this.hasher.hash('a password that is never anyone\'s')
    return await this.dummyDigest
  }

  async auth (params: AuthenticateParams): Promise<AuthenticatedSession | null> {
    const found = await this.loadAccountByEmailRepository.loadByEmail(params.email)

    if (found === null) {
      await this.hashComparer.compare(params.password, await this.getDummyDigest())
      return null
    }

    const matches = await this.hashComparer.compare(params.password, found.passwordDigest)
    if (!matches) return null

    return await this.startSession.start(found.account)
  }
}

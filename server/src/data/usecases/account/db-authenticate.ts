import type {AuthenticatedSession} from '../../../domain/models/session.js';
import type {Authenticate, AuthenticateParams} from '../../../domain/usecases/authenticate.js';
import type {StartSession} from '../../../domain/usecases/start-session.js';
import type {Hasher} from '../../protocols/cryptography/hasher.js';
import type {HashComparer} from '../../protocols/cryptography/hash-comparer.js';
import type {LoadAccountByEmailRepository} from '../../protocols/db/account/load-account-by-email-repository.js';

const DUMMY_PASSWORD = "a password that is never anyone's";

export class DbAuthenticate implements Authenticate {
  private dummyDigest: Promise<string> | null = null;

  constructor(
    private readonly loadAccountByEmailRepository: LoadAccountByEmailRepository,
    private readonly hasher: Hasher,
    private readonly hashComparer: HashComparer,
    private readonly startSession: StartSession,
  ) {}

  private getDummyDigest(): Promise<string> {
    this.dummyDigest ??= this.hasher.hash(DUMMY_PASSWORD).catch((error: unknown) => {
      this.dummyDigest = null;
      throw error;
    });
    return this.dummyDigest;
  }

  private async burnComparableWork(password: string): Promise<void> {
    try {
      await this.hashComparer.compare(password, await this.getDummyDigest());
      // oxlint-disable-next-line no-empty -- the work is the point; its result is deliberately unused
    } catch {}
  }

  async auth(params: AuthenticateParams): Promise<AuthenticatedSession | null> {
    const found = await this.loadAccountByEmailRepository.loadByEmail(params.email);

    if (found === null) {
      await this.burnComparableWork(params.password);
      return null;
    }

    const matches = await this.hashComparer.compare(params.password, found.passwordDigest);
    if (!matches) {
      return null;
    }

    return await this.startSession.start(found.account);
  }
}

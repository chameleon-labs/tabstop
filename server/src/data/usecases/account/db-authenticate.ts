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

  /**
   * Hashed once, on first use, at the same cost as a real digest. Without it an
   * unknown email returns in ~0ms and a known one in ~89ms, and the deliberate
   * choice to return one identical error for both cases is undone by a
   * stopwatch. Only the very first unknown-email login pays for two derivations
   * rather than one; deriving it in the constructor would trade that one-shot
   * cost for async work started by a constructor, which is worse.
   *
   * A rejection must NOT stay cached. `??=` stores a rejected promise just as
   * happily as a fulfilled one, so a single transient hashing failure would be
   * re-thrown for the life of the process - and only on the unknown-email path,
   * turning a 500-vs-401 split into exactly the account-existence oracle this
   * exists to close. Verified: with `??=` alone, three attempts all reject
   * while the hasher is invoked once.
   */
  private getDummyDigest(): Promise<string> {
    this.dummyDigest ??= this.hasher.hash(DUMMY_PASSWORD).catch((error: unknown) => {
      this.dummyDigest = null;
      throw error;
    });
    return this.dummyDigest;
  }

  /**
   * Burns comparable work for an email that does not exist. A failure here is
   * swallowed on purpose: being unable to waste time is not a reason to answer
   * 500 where a real account would have received 401.
   */
  private async burnComparableWork(password: string): Promise<void> {
    try {
      await this.hashComparer.compare(password, await this.getDummyDigest());
    } catch {
      // Deliberately ignored - see above.
    }
  }

  async auth(params: AuthenticateParams): Promise<AuthenticatedSession | null> {
    const found = await this.loadAccountByEmailRepository.loadByEmail(params.email);

    if (found === null) {
      await this.burnComparableWork(params.password);
      return null;
    }

    const matches = await this.hashComparer.compare(params.password, found.passwordDigest);
    if (!matches) return null;

    return await this.startSession.start(found.account);
  }
}

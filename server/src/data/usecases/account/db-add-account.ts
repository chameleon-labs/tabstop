import type {AuthenticatedSession} from '../../../domain/models/session.js';
import type {AddAccount, AddAccountParams} from '../../../domain/usecases/add-account.js';
import type {StartSession} from '../../../domain/usecases/start-session.js';
import type {Hasher} from '../../protocols/cryptography/hasher.js';
import type {AddAccountRepository} from '../../protocols/db/account/add-account-repository.js';

export class DbAddAccount implements AddAccount {
  constructor(
    private readonly hasher: Hasher,
    private readonly addAccountRepository: AddAccountRepository,
    private readonly startSession: StartSession,
  ) {}

  async add(params: AddAccountParams): Promise<AuthenticatedSession | null> {
    const passwordDigest = await this.hasher.hash(params.password);

    // No "does this email exist" check first: it would be a race with no
    // benefit, since the unique constraint has to be handled either way.
    const account = await this.addAccountRepository.add({
      email: params.email,
      passwordDigest,
    });
    if (account === null) {
      return null;
    }

    return await this.startSession.start(account);
  }
}

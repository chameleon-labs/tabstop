import type {RevokeSession} from '../../../domain/usecases/revoke-session.js';
import type {DeleteSessionRepository} from '../../protocols/db/session/delete-session-repository.js';

export class DbRevokeSession implements RevokeSession {
  constructor(private readonly deleteSessionRepository: DeleteSessionRepository) {}

  async revoke(sessionId: string): Promise<void> {
    await this.deleteSessionRepository.deleteById(sessionId);
  }
}

import type {AlertUnsubscribeTokenCodec} from '../../protocols/cryptography/alert-unsubscribe-token-codec.js';
import type {DisablePageAlertsRepository} from '../../protocols/db/alert-event/disable-page-alerts-repository.js';
import type {UnsubscribePageAlerts} from '../../../domain/usecases/unsubscribe-page-alerts.js';

export class DbUnsubscribePageAlerts implements UnsubscribePageAlerts {
  constructor(
    private readonly tokens: AlertUnsubscribeTokenCodec,
    private readonly pages: DisablePageAlertsRepository,
  ) {}

  async unsubscribe(token: string): Promise<boolean> {
    const pageId = this.tokens.decode(token);
    return pageId === null ? false : await this.pages.disablePageAlerts(pageId);
  }
}

import type {Selectable} from 'kysely';
import type {PageModel} from '../../../../domain/models/page.js';
import type {PagesTable} from '../database.js';

export const toPageModel = (row: Selectable<PagesTable>): PageModel => ({
  id: row.id,
  siteId: row.site_id,
  url: row.url,
  monitoringEnabled: row.monitoring_enabled,
  createdAt: row.created_at,
});

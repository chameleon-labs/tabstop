import { DbAddPage } from '../../../../data/usecases/page/db-add-page.js'
import { DbDeletePage } from '../../../../data/usecases/page/db-delete-page.js'
import { DbLoadPages } from '../../../../data/usecases/page/db-load-pages.js'
import { DbUpdatePage } from '../../../../data/usecases/page/db-update-page.js'
import type { AddPage } from '../../../../domain/usecases/add-page.js'
import type { DeletePage } from '../../../../domain/usecases/delete-page.js'
import type { LoadPages } from '../../../../domain/usecases/load-pages.js'
import type { UpdatePage } from '../../../../domain/usecases/update-page.js'
import {
  PostgresAuditRepository
} from '../../../../infra/db/postgres/audit/postgres-audit-repository.js'
import { PostgresPageRepository } from '../../../../infra/db/postgres/page/postgres-page-repository.js'
import { DEFAULT_URL_POLICY } from '../../../../infra/net/ip-address-policy.js'
import { NodeDnsResolver } from '../../../../infra/net/node-dns-resolver.js'
import { getDatabase } from '../../../config/database.js'
import { PAGE_LIMIT } from '../../../config/page-limits.js'
import { getAuditQueue } from '../../queue/audit-queue.js'

export const makeAddPage = (): AddPage => new DbAddPage(
  new PostgresPageRepository(getDatabase()),
  // Only for the cleanup path when the queue refuses the first job. The page
  // repository owns every other audit write in this flow, inside its
  // transaction.
  new PostgresAuditRepository(getDatabase()),
  getAuditQueue(),
  new NodeDnsResolver(),
  DEFAULT_URL_POLICY,
  PAGE_LIMIT
)

export const makeLoadPages = (): LoadPages =>
  new DbLoadPages(new PostgresPageRepository(getDatabase()), PAGE_LIMIT)

export const makeUpdatePage = (): UpdatePage =>
  new DbUpdatePage(new PostgresPageRepository(getDatabase()))

export const makeDeletePage = (): DeletePage =>
  new DbDeletePage(new PostgresPageRepository(getDatabase()))

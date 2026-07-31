import { DbUnsubscribePageAlerts } from '../../../../data/usecases/alert/unsubscribe-page-alerts.js'
import type {
  UnsubscribePageAlerts
} from '../../../../domain/usecases/unsubscribe-page-alerts.js'
import { HmacAlertUnsubscribeToken } from '../../../../infra/cryptography/hmac-alert-unsubscribe-token.js'
import {
  PostgresAlertEventRepository
} from '../../../../infra/db/postgres/alert-event/postgres-alert-event-repository.js'
import { getDatabase } from '../../../config/database.js'
import { env } from '../../../config/env.js'

export const makeUnsubscribePageAlerts = (): UnsubscribePageAlerts =>
  new DbUnsubscribePageAlerts(
    new HmacAlertUnsubscribeToken(env.alertUnsubscribeSecret),
    new PostgresAlertEventRepository(getDatabase())
  )

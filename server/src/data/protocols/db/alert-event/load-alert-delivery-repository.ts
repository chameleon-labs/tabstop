import type { AlertKind } from '../../../../domain/models/alert-event.js'
import type { Impact } from '../../../../domain/models/impact.js'

export type AlertViolation = {
  ruleId: string
  impact: Impact | null
  description: string
  nodeCount: number
}

export type AlertDelivery = {
  eventId: string
  pageId: string
  kind: AlertKind
  recipient: string
  pageUrl: string
  current: {
    publicUuid: string
    score: number
    violations: AlertViolation[]
  }
  previous: {
    score: number
    violations: AlertViolation[]
  }
  alertsEnabled: boolean
  emailedAt: Date | null
}

export interface LoadAlertDeliveryRepository {
  loadAlertDelivery: (alertEventId: string) => Promise<AlertDelivery | null>
}

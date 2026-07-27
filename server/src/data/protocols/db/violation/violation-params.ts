import type { Impact } from '../../../../domain/models/impact.js'
import type { ViolationNode } from '../../../../domain/models/violation.js'

export type AddViolationParams = {
  ruleId: string
  impact: Impact
  description: string
  helpUrl: string
  nodes: ViolationNode[]
}

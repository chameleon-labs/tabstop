import type { Impact } from './impact.js'

export type ViolationNode = {
  target: string[]
  html: string
}

export type ViolationModel = {
  id: string
  auditId: string
  ruleId: string
  impact: Impact
  description: string
  helpUrl: string
  nodes: ViolationNode[]
}

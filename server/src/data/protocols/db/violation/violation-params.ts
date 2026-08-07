import type {Impact} from '../../../../domain/models/impact.js';
import type {ViolationNode} from '../../../../domain/models/violation.js';

export type AddViolationParams = {
  ruleId: string;
  /** Null when axe reports no severity. Stored, but left out of the counts. */
  impact: Impact | null;
  description: string;
  helpUrl: string;
  nodes: ViolationNode[];
};

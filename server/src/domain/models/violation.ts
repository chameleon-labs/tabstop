import type {Impact} from './impact.js';

export type ViolationNode = {
  target: string[];
  html: string;
};

export type ViolationModel = {
  id: string;
  auditId: string;
  ruleId: string;
  /** Null when axe reports no severity; such violations are stored but uncounted. */
  impact: Impact | null;
  description: string;
  helpUrl: string;
  nodes: ViolationNode[];
};

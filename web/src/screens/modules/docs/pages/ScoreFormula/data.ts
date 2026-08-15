import type {DocSectionDescriptor} from '../../sections';

export const SCORE_SECTIONS = [
  {id: 'purpose', label: 'What the score is for'},
  {id: 'formula', label: 'The formula'},
  {id: 'weights', label: 'Impact weights'},
  {id: 'cap', label: 'The element cap'},
  {id: 'worked-example', label: 'Worked example'},
  {id: 'versioning', label: 'Version comparability'},
  {id: 'not-measured', label: 'What it does not measure'},
  {id: 'vs-lighthouse', label: 'Why not Lighthouse?'},
  {id: 'limitations', label: 'Limitations'},
] as const satisfies readonly DocSectionDescriptor[];

export const SCORE_WEIGHTS = [
  {
    impact: 'critical',
    badgeImpact: 'critical',
    weight: 10,
    maximum: 50,
    rationale: 'Blocks access entirely for some users',
  },
  {
    impact: 'serious',
    badgeImpact: 'serious',
    weight: 5,
    maximum: 25,
    rationale: 'Significantly impairs use',
  },
  {
    impact: 'moderate',
    badgeImpact: 'moderate',
    weight: 2,
    maximum: 10,
    rationale: 'Causes difficulty or confusion',
  },
  {
    impact: 'minor',
    badgeImpact: 'minor',
    weight: 1,
    maximum: 5,
    rationale: 'Creates friction; rarely blocks',
  },
  {
    impact: 'unrated',
    badgeImpact: null,
    weight: 1,
    maximum: 5,
    rationale: 'Still counts when axe reports no impact',
  },
] as const;

export const WORKED_EXAMPLE = {
  page: 'acme.example/checkout',
  engine: 'axe-core 4.12.1',
  rows: [
    {impact: 'critical', ruleId: 'label', elements: 3, cappedElements: 3, weight: 10, penalty: 30},
    {impact: 'serious', ruleId: 'link-name', elements: 1, cappedElements: 1, weight: 5, penalty: 5},
    {impact: 'minor', ruleId: 'region', elements: 8, cappedElements: 5, weight: 1, penalty: 5},
  ],
  totalPenalties: 40,
  score: 60,
} as const;

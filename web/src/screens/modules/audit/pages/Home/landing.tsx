import type {ReactNode} from 'react';
import type {HeaderSection} from '@/screens/components/SiteHeader';
import {memo} from 'react';
import {Link} from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Eyebrow,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  VisuallyHidden,
} from '@chameleon-labs/lattice-react';
import {ArrowRight, Check, ChevronRight, ExternalLink, Mail, TrendingDown, X} from '@/screens/components/Icons';
import {BrandMark} from '@/screens/components/BrandMark';
import {ImpactBadge} from '../../components/ImpactBadge';
import {ScoreArc} from '../../components/ScoreArc';
import {ScoreChart} from './LandingParts/score-chart';
import './landing.css';

type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export const LANDING_SECTIONS: readonly HeaderSection[] = [
  {id: 'how', label: 'How it works'},
  {id: 'why', label: 'Why tabstop'},
  {id: 'scope', label: 'v1 scope'},
];

const TRUST_STATS = [
  {value: 'axe-core', label: 'Engine', sub: 'industry standard'},
  {value: 'Chromium', label: 'Browser', sub: 'via Playwright'},
  {value: 'Daily', label: 'Cadence', sub: 'automatic re-audits'},
  {value: '<1 hr', label: 'Alert lag', sub: 'after deploy detected'},
  {value: '30 sec', label: 'Setup time', sub: 'zero config'},
] as const;

const VIOLATIONS: readonly {impact: Impact; count: number; rule: string; desc: string}[] = [
  {
    impact: 'critical',
    count: 2,
    rule: 'color-contrast',
    desc: 'Elements must meet minimum color contrast ratio',
  },
  {
    impact: 'serious',
    count: 5,
    rule: 'image-alt',
    desc: 'Images must have alternate text',
  },
  {
    impact: 'moderate',
    count: 3,
    rule: 'label',
    desc: 'Form elements must have labels',
  },
  {
    impact: 'minor',
    count: 7,
    rule: 'region',
    desc: 'All page content should be contained by landmarks',
  },
];

const SCORE_HISTORY = [
  {date: 'Jul 1', score: 91},
  {date: 'Jul 5', score: 89},
  {date: 'Jul 9', score: 91},
  {date: 'Jul 13', score: 88},
  {date: 'Jul 17', score: 84},
  {date: 'Jul 21', score: 61},
  {date: 'Jul 25', score: 63},
  {date: 'Jul 29', score: 66},
  {date: 'Aug 2', score: 71},
] as const;

const STEPS = [
  {
    n: '01',
    title: 'Paste a URL',
    body: 'No account, no pipeline, no config files. Drop in any public URL and tabstop kicks off a real Chromium audit — the same engine behind most a11y tooling in the industry.',
    detail: 'axe-core · Playwright · Chromium',
  },
  {
    n: '02',
    title: 'Get a score and violation list',
    body: 'Violations are grouped by impact: critical, serious, moderate, minor. Each entry shows affected selectors and links to fix documentation. The score is designed for trending, not gatekeeping.',
    detail: 'WCAG 2.1 AA · grouped by impact',
  },
  {
    n: '03',
    title: 'Track it over time',
    body: 'Add the URL to monitoring and tabstop re-audits it every day. Your score is charted so regressions are obvious at a glance. Any new serious or critical violation — or a score drop — sends one email.',
    detail: 'Daily cadence · one email per event',
  },
] as const;

const COMPETITORS = [
  {
    name: 'Lighthouse CI',
    cost: 'Free',
    setup: 'Pipeline integration',
    trend: false,
    alert: false,
    zeroCfg: false,
    highlight: false,
  },
  {
    name: 'pa11y-dashboard',
    cost: 'Free',
    setup: 'Self-hosted',
    trend: true,
    alert: true,
    zeroCfg: false,
    highlight: false,
  },
  {name: 'axe Monitor', cost: '$$$', setup: 'Sales call', trend: true, alert: true, zeroCfg: false, highlight: false},
  {
    name: 'tabstop',
    cost: 'Free in beta',
    setup: 'Paste a URL',
    trend: true,
    alert: true,
    zeroCfg: true,
    highlight: true,
  },
] as const;

const V1_IN = [
  'Single public URLs',
  'Chromium (Playwright + axe-core)',
  'Daily re-audit cadence',
  'Email alerts on regression',
  'Public shareable result pages',
  'Score trend chart',
];

const V1_OUT = [
  'Site crawling',
  'Authenticated pages',
  'CI integration + API tokens',
  'Viewport matrix',
  'Teams & orgs',
  'Slack alerts',
  'WCAG level config',
];

const FOOTER_PLACEHOLDER_LINKS = ['DECISIONS.md', 'GitHub', 'How it works'];

function Section({id, className, children}: {id?: string; className?: string; children: ReactNode}): React.JSX.Element {
  const cls = ['landing-page__section', className].filter((value): value is string => Boolean(value)).join(' ');
  return (
    <section id={id} className={cls}>
      {children}
    </section>
  );
}

function BoolCell({value}: {value: boolean}): React.JSX.Element {
  return (
    <Td className="landing-page__bool-cell">
      {value ? (
        <Check size="md" className="landing-page__bool-check" />
      ) : (
        <X size="md" className="landing-page__bool-x" />
      )}
      <VisuallyHidden>{value ? 'Yes' : 'No'}</VisuallyHidden>
    </Td>
  );
}

function Hero({urlField, feedback}: {urlField: ReactNode; feedback: ReactNode}): React.JSX.Element {
  return (
    <Section id="audit" className="landing-page__hero">
      <div className="landing-page__hero-grid">
        <div className="landing-page__hero-copy">
          <div className="landing-page__hero-kicker">
            <Eyebrow tone="accent">Early access</Eyebrow>
            <span className="landing-page__hero-dot" aria-hidden="true" />
            <span className="landing-page__hero-kicker-sub">Building in public</span>
          </div>

          <h1 className="lat-page__display landing-page__display">
            Accessibility <br />
            monitoring <br />
            <span className="landing-page__accent-text">without the setup.</span>
          </h1>

          <p className="landing-page__lede">
            Paste a URL, get an audit and a score. tabstop re-audits daily, charts your score over time, and emails you
            the day a deploy makes things worse.
          </p>

          {urlField}

          {feedback}

          <p className="landing-page__meta">No account needed · Results in ~30 seconds</p>
        </div>

        <div className="landing-page__audit-wrap">
          <div className="landing-page__audit-glow" aria-hidden="true" />

          <Card data-elevation="floating" className="landing-page__audit-card">
            <div className="landing-page__audit-header">
              <div className="landing-page__audit-dots" aria-hidden="true">
                <span className="landing-page__audit-dot landing-page__audit-dot--critical" />
                <span className="landing-page__audit-dot landing-page__audit-dot--serious" />
                <span className="landing-page__audit-dot landing-page__audit-dot--primary" />
              </div>
              <span className="landing-page__audit-url">https://acme.example</span>
              <span className="landing-page__audit-meta">audited 4 min ago</span>
            </div>
            <CardBody className="landing-page__audit-summary">
              <ScoreArc score={71} size={100} />
              <div className="landing-page__audit-signals">
                <div>
                  <div className="landing-page__audit-violations-label">Violations</div>
                  <div className="landing-page__audit-counts">
                    {VIOLATIONS.map((v) => (
                      <span
                        key={v.impact}
                        className={`landing-page__audit-count landing-page__audit-count--${v.impact}`}
                      >
                        {v.count} {v.impact}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="landing-page__audit-trend">
                  <TrendingDown size="sm" />
                  <span>−23 pts on the Jul 21 deploy</span>
                </div>
                <div className="landing-page__audit-alert">
                  <Mail size="sm" />
                  <span>Alert sent</span>
                </div>
              </div>
            </CardBody>
            <ul className="landing-page__audit-violations">
              {VIOLATIONS.slice(0, 3).map((v) => (
                <li key={v.rule} className="landing-page__audit-violation">
                  <ImpactBadge impact={v.impact} />
                  <div className="landing-page__audit-violation-copy">
                    <p className="landing-page__audit-violation-rule">{v.rule}</p>
                    <p className="landing-page__audit-violation-desc">{v.desc}</p>
                  </div>
                  <span className="landing-page__audit-violation-count">{v.count}×</span>
                </li>
              ))}
            </ul>
            <div className="landing-page__audit-footer">
              <Button variant="link" size="sm">
                View full report
                <ExternalLink size="sm" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

const TrustBar = memo(() => (
  <div className="landing-page__trust-bar">
    <Section className="landing-page__trust-bar-inner">
      {TRUST_STATS.map((s) => (
        <Stat key={s.label} value={s.value} label={s.label} sub={s.sub} className="landing-page__trust-stat" />
      ))}
    </Section>
  </div>
));

const HowItWorks = memo(() => (
  <Section id="how" className="landing-page__how">
    <Eyebrow rule tone="accent" className="landing-page__section-eyebrow">
      How it works
    </Eyebrow>
    <h2 className="landing-page__heading landing-page__heading--how">Zero setup. Baseline in thirty seconds.</h2>

    <div className="landing-page__steps">
      {STEPS.map((s) => (
        <Card key={s.n}>
          <CardBody>
            <span className="landing-page__step-index">{s.n}</span>
            <h3 className="landing-page__step-title">{s.title}</h3>
            <p className="landing-page__step-body">{s.body}</p>
            <p className="landing-page__step-detail">{s.detail}</p>
          </CardBody>
        </Card>
      ))}
    </div>
  </Section>
));

const ScoreHistory = memo(() => (
  <Section className="landing-page__score-history">
    <Card>
      <CardHeader label="Score history — acme.example">
        <Badge variant="danger">
          <TrendingDown size="sm" />
          −20 pts since Jul 1
        </Badge>
      </CardHeader>
      <CardBody className="landing-page__score-history-body">
        <Stat
          value="71"
          label="Current score"
          sub="down from 91 on Jul 1"
          className="landing-page__score-history-stat"
        />

        <figure
          className="landing-page__chart-figure"
          aria-label="Score history for acme.example: a line chart of nine audits from Jul 1 to Aug 2, trending down 20 points since Jul 1"
        >
          <ScoreChart data={SCORE_HISTORY} referenceDate="Jul 21" />
          <VisuallyHidden>
            <Table caption="Score history for acme.example, nine audits from Jul 1 to Aug 2" visuallyHiddenCaption>
              <THead>
                <Tr>
                  <Th scope="col">Date</Th>
                  <Th scope="col">Score</Th>
                </Tr>
              </THead>
              <TBody>
                {SCORE_HISTORY.map((point) => (
                  <Tr key={point.date}>
                    <Th scope="row">{point.date}</Th>
                    <Td>{point.score}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </VisuallyHidden>
        </figure>
      </CardBody>
    </Card>
  </Section>
));

const Why = memo(() => (
  <Section id="why" className="landing-page__why">
    <Eyebrow rule tone="accent" className="landing-page__section-eyebrow">
      Why tabstop
    </Eyebrow>

    <div className="landing-page__why-grid">
      <div>
        <h2 className="landing-page__heading landing-page__heading--why">
          CI catches regressions <br />
          if you set it up. <br />
          <span className="landing-page__muted-inline">Nobody sets it up.</span>
        </h2>
        <p className="landing-page__muted">
          I contribute to Ariakit, an accessibility-focused UI component library. This is the monitoring tool I kept
          wishing the people using it had — zero-setup, monitoring rather than gating.
        </p>
        <p className="landing-page__muted">
          Existing options each miss the mark for small teams: CI tools need engineering buy-in, dashboards need
          self-hosting, and commercial monitors start with a sales call.
        </p>
      </div>

      <Card>
        <CardBody>
          <Table caption="How tabstop compares to other accessibility monitoring tools" visuallyHiddenCaption>
            <THead>
              <Tr>
                <Th scope="col">Tool</Th>
                <Th scope="col">Setup</Th>
                <Th scope="col" className="landing-page__bool-header">
                  Trend
                </Th>
                <Th scope="col" className="landing-page__bool-header">
                  Alerts
                </Th>
                <Th scope="col" className="landing-page__bool-header">
                  0-cfg
                </Th>
              </Tr>
            </THead>
            <TBody>
              {COMPETITORS.map((c) => (
                <Tr key={c.name} data-highlight={c.highlight ? 'true' : undefined}>
                  <Th scope="row">
                    <span className="landing-page__competitor-name">{c.name}</span>
                    <span className="landing-page__competitor-cost">{c.cost}</span>
                  </Th>
                  <Td>{c.setup}</Td>
                  <BoolCell value={c.trend} />
                  <BoolCell value={c.alert} />
                  <BoolCell value={c.zeroCfg} />
                </Tr>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  </Section>
));

const V1Scope = memo(() => (
  <Section id="scope" className="landing-page__scope">
    <Eyebrow rule tone="accent" className="landing-page__section-eyebrow">
      v1 scope
    </Eyebrow>
    <h2 className="landing-page__heading landing-page__heading--scope">Deliberately scoped.</h2>

    <div className="landing-page__scope-grid">
      <Card>
        <CardHeader label="In v1" />
        <CardBody>
          <ul className="landing-page__scope-list">
            {V1_IN.map((item) => (
              <li key={item}>
                <Check size="md" className="landing-page__check-icon" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader label="Not in v1 — roadmap" />
        <CardBody>
          <ul className="landing-page__scope-list landing-page__scope-list--muted">
            {V1_OUT.map((item) => (
              <li key={item}>
                <ChevronRight size="md" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  </Section>
));

const CTA = memo(() => (
  <div className="landing-page__cta">
    <Section className="landing-page__cta-inner">
      <div className="landing-page__cta-content">
        <Eyebrow tone="accent" align="center" className="landing-page__cta-eyebrow">
          Early access — free
        </Eyebrow>
        <h2 className="landing-page__heading landing-page__heading--cta">Know the moment you break accessibility.</h2>
        <p className="landing-page__muted">No account needed to run your first audit.</p>

        <Button variant="primary" size="lg" className="landing-page__cta-button" render={<a href="#audit" />}>
          Audit a page
          <ArrowRight size="md" aria-hidden="true" />
        </Button>

        <p className="landing-page__meta">MIT licensed · Built in public · Follow DECISIONS.md</p>
      </div>
    </Section>
  </div>
));

const Footer = memo(() => (
  <footer className="landing-page__footer">
    <Section className="landing-page__footer-inner">
      <div className="landing-page__brand">
        <BrandMark size="sm" />
        <span className="landing-page__footer-copy">tabstop — MIT license</span>
      </div>

      <nav className="landing-page__footer-links" aria-label="Footer links">
        {FOOTER_PLACEHOLDER_LINKS.map((label) => (
          // oxlint-disable-next-line jsx-a11y/anchor-is-valid
          <Button key={label} variant="link" size="sm" render={<a href="#" />}>
            {label}
          </Button>
        ))}
        <Button variant="link" size="sm" render={<Link to="/docs/score-formula" />}>
          Score formula
        </Button>
      </nav>
    </Section>
  </footer>
));

export type LandingProps = {
  urlField: ReactNode;
  feedback: ReactNode;
};

export function Landing({urlField, feedback}: LandingProps): React.JSX.Element {
  return (
    <div className="lat-page lat-surface landing-page">
      <main id="main" tabIndex={-1} className="landing-page__main">
        <Hero urlField={urlField} feedback={feedback} />
        <TrustBar />
        <HowItWorks />
        <ScoreHistory />
        <Why />
        <V1Scope />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

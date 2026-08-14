import {Check} from '@/screens/components/Icons';
import {PHASES} from '../../phase';
import './audit-progress.css';

export type AuditProgressProps = {
  phase: string | null;
  complete?: boolean;
};

const stateOf = (index: number, active: number): 'done' | 'active' | 'pending' => {
  if (index < active) {
    return 'done';
  }
  return index === active ? 'active' : 'pending';
};

export const AuditProgress = ({phase, complete = false}: AuditProgressProps): React.JSX.Element => {
  const found = PHASES.findIndex((candidate) => candidate.label === phase);
  const active = complete ? PHASES.length : found;
  const done = Math.max(0, active);

  return (
    <div className="audit-progress" aria-hidden="true">
      <div className="audit-progress__chrome">
        <span className="audit-progress__dots">
          <span className="audit-progress__dot" />
          <span className="audit-progress__dot" />
          <span className="audit-progress__dot" />
        </span>
        <span className="audit-progress__name">audit.log</span>
      </div>
      <ol className="audit-progress__steps">
        {PHASES.map((step, index) => {
          const state = stateOf(index, active);
          let marker = <span className="audit-progress__pip" />;
          if (state === 'done') {
            marker = <Check size="sm" />;
          } else if (state === 'active') {
            marker = <span className="audit-progress__spinner" />;
          }
          return (
            <li key={step.label} className="audit-progress__step" data-state={state}>
              <span className="audit-progress__marker">{marker}</span>
              {step.label}
            </li>
          );
        })}
      </ol>
      <div className="audit-progress__track">
        <span className="audit-progress__fill" style={{inlineSize: `${(done / PHASES.length) * 100}%`}} />
      </div>
      <p className="audit-progress__footer">
        <span>axe-core · Chromium</span>
        <span>
          {done}/{PHASES.length} steps
        </span>
      </p>
    </div>
  );
};

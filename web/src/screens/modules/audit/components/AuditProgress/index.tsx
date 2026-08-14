import type {AuditStatus} from '@tabstop/contract';
import {Check} from '@/screens/components/Icons';
import {PHASES} from '../../phase';
import './audit-progress.css';

export type AuditProgressProps = {
  status: AuditStatus;
  phase: string | null;
};

const stateOf = (index: number, active: number): 'done' | 'active' | 'pending' => {
  if (index < active) {
    return 'done';
  }
  return index === active ? 'active' : 'pending';
};

export const AuditProgress = ({status, phase}: AuditProgressProps): React.JSX.Element => {
  const active = PHASES.findIndex((candidate) => candidate.label === phase);
  const done = active === -1 ? 0 : active;

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
        {PHASES.map((step, index) => (
          <li key={step.label} className="audit-progress__step" data-state={stateOf(index, active)}>
            <span className="audit-progress__marker">
              {index < active ? <Check size="sm" /> : <span className="audit-progress__pip" />}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
      <div className="audit-progress__track">
        <span className="audit-progress__fill" style={{inlineSize: `${(done / PHASES.length) * 100}%`}} />
      </div>
      <p className="audit-progress__footer">
        <span>{status === 'queued' ? 'waiting for a worker' : 'running'}</span>
        <span>
          {done}/{PHASES.length} steps
        </span>
      </p>
    </div>
  );
};

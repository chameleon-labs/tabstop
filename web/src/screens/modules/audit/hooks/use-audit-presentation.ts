import type {AuditStatus} from '@tabstop/contract';
import {useEffect, useMemo, useState} from 'react';
import {PHASES} from '../phase';

export const FAST_PHASE_MS = 300;
export const SCORING_HOLD_MS = 500;
export const COMPLETE_HOLD_MS = 250;
export const PROGRESS_EXIT_MS = 200;

export type AuditPresentationView = 'progress' | 'exiting' | 'failure' | 'report';

export type AuditPresentation = {
  view: AuditPresentationView;
  phase: string | null;
  complete: boolean;
  headline: string | null;
  completedInSession: boolean;
};

export type AuditPresentationOptions = {
  auditId: string;
  status: AuditStatus | undefined;
  phase: string | null;
  owner: boolean;
  failure: boolean;
};

type Frame = AuditPresentation & {holdMs: number | null};

const frameForPhase = (index: number): Frame => {
  const phase = PHASES[index]?.label ?? null;
  return {
    view: 'progress',
    phase,
    complete: false,
    headline: phase === null ? null : `${phase}…`,
    completedInSession: true,
    holdMs: index === PHASES.length - 1 ? SCORING_HOLD_MS : FAST_PHASE_MS,
  };
};

const finishFramesFrom = (phase: string | null): readonly Frame[] => {
  const current = PHASES.findIndex((candidate) => candidate.label === phase);
  const firstUnseen = current < 0 ? 0 : Math.min(current + 1, PHASES.length - 1);
  const phaseFrames = Array.from({length: PHASES.length - firstUnseen}, (_, offset) =>
    frameForPhase(firstUnseen + offset),
  );

  return [
    ...phaseFrames,
    {
      view: 'progress',
      phase: null,
      complete: true,
      headline: 'Audit complete',
      completedInSession: true,
      holdMs: COMPLETE_HOLD_MS,
    },
    {
      view: 'exiting',
      phase: null,
      complete: true,
      headline: 'Audit complete',
      completedInSession: true,
      holdMs: PROGRESS_EXIT_MS,
    },
    {
      view: 'report',
      phase: null,
      complete: true,
      headline: null,
      completedInSession: true,
      holdMs: null,
    },
  ];
};

const LOOKING_HEADLINE = 'Looking for that audit…';

type Tracked = {
  auditId: string;
  progress: boolean;
  phase: string | null;
};

type ImmediateOptions = Omit<AuditPresentationOptions, 'auditId'> & {progress: boolean};

const immediateFor = ({status, phase, owner, failure, progress}: ImmediateOptions): AuditPresentation | null => {
  if (failure || status === 'failed') {
    return {view: 'failure', phase: null, complete: false, headline: LOOKING_HEADLINE, completedInSession: false};
  }

  if (status === undefined) {
    return {view: 'progress', phase: null, complete: false, headline: LOOKING_HEADLINE, completedInSession: false};
  }

  if (status === 'queued' || status === 'running') {
    return {
      view: 'progress',
      phase,
      complete: false,
      headline: phase === null ? LOOKING_HEADLINE : `${phase}…`,
      completedInSession: false,
    };
  }

  if (!owner && !progress) {
    return {view: 'report', phase: null, complete: true, headline: null, completedInSession: false};
  }

  return null;
};

const trackedFor = (
  seen: Tracked,
  {
    auditId,
    status,
    phase,
    inProgress,
  }: {auditId: string; status: AuditStatus | undefined; phase: string | null; inProgress: boolean},
): Tracked => {
  if (seen.auditId !== auditId) {
    return {auditId, progress: inProgress, phase: status === 'running' ? phase : null};
  }

  if (!inProgress) {
    return seen;
  }

  const running = status === 'running' && phase !== null ? phase : seen.phase;
  if (seen.progress && seen.phase === running) {
    return seen;
  }

  return {auditId, progress: true, phase: running};
};

export const useAuditPresentation = ({
  auditId,
  status,
  phase,
  owner,
  failure,
}: AuditPresentationOptions): AuditPresentation => {
  const inProgress = status === 'queued' || status === 'running';
  const [seen, setSeen] = useState<Tracked>(() => ({auditId, progress: false, phase: null}));

  const tracked = trackedFor(seen, {auditId, status, phase, inProgress});

  if (tracked !== seen) {
    setSeen(tracked);
  }

  const immediate = immediateFor({status, phase, owner, failure, progress: tracked.progress});
  const settling = immediate === null;
  const frames = useMemo(() => finishFramesFrom(tracked.phase), [tracked.phase]);
  const [step, setStep] = useState(0);
  const [sequence, setSequence] = useState({auditId, settling});

  if (sequence.auditId !== auditId || sequence.settling !== settling) {
    setSequence({auditId, settling});
    setStep(0);
  }

  useEffect(() => {
    if (!settling) {
      return undefined;
    }

    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const advance = (): void => {
      const holdMs = frames[index]?.holdMs ?? null;
      if (cancelled || holdMs === null) {
        return;
      }

      timer = setTimeout(() => {
        if (cancelled) {
          return;
        }

        index += 1;
        setStep(index);
        advance();
      }, holdMs);
    };

    advance();

    return (): void => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [settling, frames]);

  const current = immediate ?? frames[Math.min(step, frames.length - 1)];
  if (current === undefined) {
    return {view: 'report', phase: null, complete: true, headline: null, completedInSession: true};
  }

  return {
    view: current.view,
    phase: current.phase,
    complete: current.complete,
    headline: current.headline,
    completedInSession: current.completedInSession,
  };
};

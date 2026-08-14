import type {AuditStatus} from '@tabstop/contract';
import {useEffect, useRef, useState} from 'react';
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

type StoredPresentation = AuditPresentation & {auditId: string};

const looking = (auditId: string): StoredPresentation => ({
  auditId,
  view: 'progress',
  phase: null,
  complete: false,
  headline: 'Looking for that audit…',
  completedInSession: false,
});

export const useAuditPresentation = ({
  auditId,
  status,
  phase,
  owner,
  failure,
}: AuditPresentationOptions): AuditPresentation => {
  const [stored, setStored] = useState<StoredPresentation>(() => looking(auditId));
  const identity = useRef(auditId);
  const observedProgress = useRef(false);
  const lastRunningPhase = useRef<string | null>(null);

  if (identity.current !== auditId) {
    identity.current = auditId;
    observedProgress.current = false;
    lastRunningPhase.current = null;
  }

  useEffect(() => {
    if (failure || status === 'failed') {
      setStored({...looking(auditId), view: 'failure'});
      return;
    }

    if (status === undefined) {
      setStored(looking(auditId));
      return;
    }

    if (status === 'queued' || status === 'running') {
      observedProgress.current = true;
      if (status === 'running' && phase !== null) {
        lastRunningPhase.current = phase;
      }
      setStored({
        auditId,
        view: 'progress',
        phase,
        complete: false,
        headline: phase === null ? 'Looking for that audit…' : `${phase}…`,
        completedInSession: false,
      });
      return;
    }

    if (!owner && !observedProgress.current) {
      setStored({
        auditId,
        view: 'report',
        phase: null,
        complete: true,
        headline: null,
        completedInSession: false,
      });
      return;
    }

    const frames = finishFramesFrom(lastRunningPhase.current);
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = (): void => {
      if (identity.current !== auditId) {
        return;
      }
      const frame = frames[index];
      if (frame === undefined) {
        return;
      }
      index += 1;
      const {holdMs, ...presentation} = frame;
      setStored({auditId, ...presentation});
      if (holdMs !== null) {
        timer = setTimeout(advance, holdMs);
      }
    };
    advance();
    return (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [auditId, failure, owner, phase, status]);

  const current = stored.auditId === auditId ? stored : looking(auditId);
  return {
    view: current.view,
    phase: current.phase,
    complete: current.complete,
    headline: current.headline,
    completedInSession: current.completedInSession,
  };
};

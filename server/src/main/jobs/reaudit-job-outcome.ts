import type {ReauditRunSummary} from '../../domain/usecases/run-scheduled-reaudits.js';

/**
 * Whether the nightly run should fail its BullMQ job, and why.
 *
 * A pure function rather than three conditions inline in the worker, because
 * this is the one piece of that handler with a decision in it - and getting it
 * wrong is invisible either way. A run that reports success when it did not
 * finish is missing from every queue dashboard there is; a run that fails when
 * it should not spends its retries for nothing.
 *
 * Returns the message to fail with, or null to report success.
 */
export const reauditRunFailure = (summary: ReauditRunSummary, shuttingDown: boolean): string | null => {
  // A run cut short by shutdown is not a failure. The process is going away,
  // so failing the job would only spend its attempts on retries this worker
  // cannot serve - and the pages it did not reach are simply due tomorrow.
  if (shuttingDown) {
    return null;
  }

  if (summary.failed > 0) {
    return `Re-audit run could not schedule ${summary.failed} page(s)`;
  }

  // A truncated run did not do the work it promised. The retry is the useful
  // part rather than a formality: every page this attempt scheduled now has an
  // audit in flight and drops out of the worklist, so the next attempt starts
  // on the tail instead of repeating the head.
  if (summary.truncated) {
    return `Re-audit run stopped at ${summary.pagesConsidered} pages with more still due`;
  }

  return null;
};

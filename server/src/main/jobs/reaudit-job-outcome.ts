import type {ReauditRunSummary} from '../../domain/usecases/run-scheduled-reaudits.js';

export const reauditRunFailure = (summary: ReauditRunSummary, shuttingDown: boolean): string | null => {
  if (shuttingDown) {
    return null;
  }

  if (summary.failed > 0) {
    return `Re-audit run could not schedule ${summary.failed} page(s)`;
  }

  if (summary.truncated) {
    return `Re-audit run stopped at ${summary.pagesConsidered} pages with more still due`;
  }

  return null;
};

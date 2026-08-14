import {useNavigate} from 'react-router';
import {useRequestAudit} from '../audits';
import {describeRequestFailure, type DescribedFailure} from '../failure';
import {sharePathFor, startedHere} from '../share';

export type StartAudit = {
  start: (url: string) => void;
  retry: () => void;
  failure: DescribedFailure | null;
  isPending: boolean;
};

export const useStartAudit = (): StartAudit => {
  const navigate = useNavigate();
  const request = useRequestAudit();

  const start = (url: string): void => {
    request.mutate(url, {
      onSuccess: (accepted) => {
        void navigate(sharePathFor(accepted.auditId), {state: startedHere()});
      },
    });
  };

  return {
    start,
    retry: (): void => {
      const url = request.variables;
      if (url === undefined) {
        return;
      }
      request.reset();
      start(url);
    },
    failure: request.error === null ? null : describeRequestFailure(request.error),
    isPending: request.isPending,
  };
};

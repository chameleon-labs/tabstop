import {phaseFor} from '../../phase';
import {AuditFailure} from '../../components/AuditFailure';
import {AuditStatus} from '../../components/AuditStatus';
import {UrlField} from '../../components/UrlField';
import {useStartAudit} from '../../hooks/use-start-audit';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {Landing} from './landing';

export const Home = (): React.JSX.Element => {
  useDocumentTitle('');

  const {start, retry, failure, isPending} = useStartAudit();

  const phase = isPending ? phaseFor('submitting', 0) : null;
  const announcement = phase === null ? null : `${phase}…`;

  const feedback = (
    <>
      {failure !== null && <AuditFailure failure={failure} onRetry={retry} />}
      <div className="visually-hidden">
        <AuditStatus message={announcement} />
      </div>
    </>
  );

  return <Landing urlField={<UrlField onSubmit={start} disabled={isPending} />} feedback={feedback} />;
};

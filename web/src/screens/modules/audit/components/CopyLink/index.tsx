import {Button} from '@chameleon-labs/lattice-react';
import {useState} from 'react';

export type CopyLinkProps = {
  url: string;
};

const OUTCOME_MESSAGES = {
  idle: '',
  copied: 'Link copied',
  failed: 'Could not copy the link',
} as const;

type Outcome = keyof typeof OUTCOME_MESSAGES;

export const CopyLink = ({url}: CopyLinkProps): React.JSX.Element => {
  const [outcome, setOutcome] = useState<Outcome>('idle');

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setOutcome('copied');
    } catch {
      setOutcome('failed');
    }
  };

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          void copy();
        }}
      >
        Copy link
      </Button>
      <p role="status" aria-live="polite">
        {OUTCOME_MESSAGES[outcome]}
      </p>
      {outcome === 'failed' && (
        <p>
          Copy it by hand: <span>{url}</span>
        </p>
      )}
    </div>
  );
};

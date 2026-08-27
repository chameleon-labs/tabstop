import {useId, useState} from 'react';
import {Button, Input} from '@chameleon-labs/lattice-react';
import {URL_PROBLEMS, normaliseUrl} from '../../url';
import {Globe, Zap} from '@/screens/components/Icons';

export type UrlFieldProps = {
  onSubmit: (url: string) => void;
  disabled?: boolean;
};

export const UrlField = ({onSubmit, disabled = false}: UrlFieldProps): React.JSX.Element => {
  const [raw, setRaw] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const inputId = useId();
  const errorId = useId();

  const parsed = normaliseUrl(raw);
  const problem = submitted && !parsed.ok ? URL_PROBLEMS[parsed.problem] : null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (parsed.ok) {
          onSubmit(parsed.url);
        }
      }}
    >
      <div className="landing-page__url-row">
        <Input
          id={inputId}
          aria-label="Page to audit"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="example.com"
          addonStart={<Globe size="md" aria-hidden="true" />}
          className="landing-page__url-field"
          inputClassName="landing-page__url-input"
          value={raw}
          disabled={disabled}
          onChange={(event) => {
            setRaw(event.target.value);
          }}
          invalid={problem !== null}
          aria-describedby={problem === null ? undefined : errorId}
        />
        <Button type="submit" variant="primary" size="lg" disabled={disabled}>
          {disabled ? (
            'Requesting…'
          ) : (
            <>
              Audit this page
              <Zap size="md" aria-hidden="true" />
            </>
          )}
        </Button>
      </div>
      <p id={errorId} role="alert">
        {problem}
      </p>
    </form>
  );
};

import {Button, Input} from '@chameleon-labs/lattice-react';
import {useId, useRef, useState} from 'react';
import {Globe} from '@/screens/components/Icons';
import {URL_PROBLEMS, normaliseUrl} from '../../url';
import './add-page-form.css';

export type AddPageFormProps = {
  /** `empty` is the onboarding surface; `compact` is the bar above the list. */
  mode: 'empty' | 'compact';
  used: number;
  limit: number;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Resolves true when the page was added, so the field knows to empty. */
  onSubmit: (canonicalUrl: string) => Promise<boolean>;
};

export const AddPageForm = ({mode, used, limit, inputRef, onSubmit}: AddPageFormProps): React.JSX.Element => {
  const [raw, setRaw] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? fallbackRef;
  const inputId = useId();
  const errorId = useId();
  const limitId = useId();

  const parsed = normaliseUrl(raw);
  const atLimit = used >= limit;
  const problem = submitted && !parsed.ok ? URL_PROBLEMS[parsed.problem] : null;
  const limitMessage = atLimit
    ? `You are monitoring ${used} of ${limit} pages. Remove a page before adding another.`
    : null;

  const describedBy = [problem === null ? null : errorId, limitMessage === null ? null : limitId]
    .filter((id): id is string => id !== null)
    .join(' ');

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);

    if (!parsed.ok || atLimit || pending) {
      if (!parsed.ok) {
        field.current?.focus();
      }

      return;
    }

    setPending(true);
    try {
      if (await onSubmit(parsed.url)) {
        setRaw('');
        setSubmitted(false);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="add-page-form" data-mode={mode} noValidate onSubmit={(event) => void submit(event)}>
      <div className="add-page-form__row">
        <Input
          id={inputId}
          ref={field}
          aria-label="Page URL"
          // `type="url"` would let the browser reject `example.com` before this
          // component sees it, which is precisely the input to accept.
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="example.com"
          addonStart={<Globe size="md" aria-hidden="true" />}
          className="add-page-form__field"
          value={raw}
          disabled={pending || atLimit}
          onChange={(event) => {
            setRaw(event.target.value);
          }}
          // Lattice's own prop: `Input` applies its version after spreading,
          // so `aria-invalid` passed directly is silently overwritten.
          invalid={problem !== null}
          aria-describedby={describedBy === '' ? undefined : describedBy}
        />
        <Button type="submit" variant="primary" size="md" disabled={pending || atLimit}>
          {pending ? 'Adding page…' : 'Add page'}
        </Button>
      </div>
      {problem !== null && (
        <p id={errorId} className="add-page-form__error">
          {problem}
        </p>
      )}
      {limitMessage !== null && (
        <p id={limitId} className="add-page-form__limit">
          {limitMessage}
        </p>
      )}
    </form>
  );
};

import { useId, useState } from 'react'
import { Button, Input } from '@chameleon-labs/lattice-react'
import { URL_PROBLEMS, normaliseUrl } from '../../url'
import { Globe, Zap } from '@/screens/components/Icons'

export type UrlFieldProps = {
  /** Receives the canonical URL, never the raw text. */
  onSubmit: (url: string) => void
  disabled?: boolean
}

/**
 * The URL input, and the product's first interaction.
 *
 * VALIDATION IS DEFERRED UNTIL SUBMIT, then live afterwards. Validating on
 * every keystroke tells someone typing `e` that `e` is not a URL, which is both
 * true and useless - the error appears before they could possibly have finished
 * and reads as the form arguing with them. Once they have submitted, they have
 * asked for a verdict, so from then on it updates as they type.
 *
 * `onSubmit` receives the normalised URL, never the raw text.
 */
export const UrlField = ({ onSubmit, disabled = false }: UrlFieldProps): React.JSX.Element => {
  const [raw, setRaw] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const inputId = useId()
  const errorId = useId()

  const parsed = normaliseUrl(raw)
  const problem = submitted && !parsed.ok ? URL_PROBLEMS[parsed.problem] : null

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (parsed.ok) onSubmit(parsed.url)
      }}
    >
      <div className="landing-page__url-row">
        <Input
          id={inputId}
          // Not the placeholder: it disappears on the first keystroke, and
          // is not exposed as a name by every browser and screen reader.
          aria-label="Page to audit"
          // `type="url"` would let the browser reject `example.com` before this
          // component ever sees it, which is precisely the input to accept.
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="example.com"
          addonStart={<Globe size="md" aria-hidden="true" />}
          className="landing-page__url-field"
          inputClassName="landing-page__url-input"
          value={raw}
          disabled={disabled}
          onChange={(event) => { setRaw(event.target.value) }}
          // Lattice's own prop, not `aria-invalid` directly: `Input` applies
          // its version AFTER spreading props, so passing the attribute here
          // is silently overwritten. It emits the attribute only when true,
          // which is equivalent for assistive tech - `aria-invalid` defaults
          // to false when absent - but it does mean the valid state is an
          // absent attribute rather than `aria-invalid="false"`.
          invalid={problem !== null}
          aria-describedby={problem === null ? undefined : errorId}
        />

        <Button type="submit" variant="primary" size="lg" disabled={disabled}>
          Audit this page
          <Zap size="md" aria-hidden="true" />
        </Button>
      </div>

      <p id={errorId} role="alert">{problem}</p>
    </form>
  )
}

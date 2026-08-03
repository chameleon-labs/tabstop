import { useId, useState } from 'react'
import { URL_PROBLEMS, normaliseUrl } from '../../audit/url'

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
 * The normalised URL is shown back BEFORE submitting, so `https://` appearing
 * from nowhere is not a surprise on the result page. It is also the exact
 * string that gets sent - showing a tidier version than the one submitted is
 * how "I typed example.com but it audited example.com/" starts.
 */
export const UrlField = ({ onSubmit, disabled = false }: UrlFieldProps): React.JSX.Element => {
  const [raw, setRaw] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const inputId = useId()
  const errorId = useId()
  const previewId = useId()

  const parsed = normaliseUrl(raw)
  const problem = submitted && !parsed.ok ? URL_PROBLEMS[parsed.problem] : null
  // Only worth showing once it differs from what they typed.
  const preview = parsed.ok && parsed.url !== raw.trim() ? parsed.url : null

  const describedBy = [
    problem === null ? null : errorId,
    preview === null ? null : previewId
  ].filter((id) => id !== null).join(' ')

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (parsed.ok) onSubmit(parsed.url)
      }}
    >
      <label htmlFor={inputId}>Page to audit</label>

      <input
        id={inputId}
        // `type="url"` would let the browser reject `example.com` before this
        // component ever sees it, which is precisely the input to accept.
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder="example.com"
        value={raw}
        disabled={disabled}
        onChange={(event) => { setRaw(event.target.value) }}
        aria-invalid={problem !== null}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />

      <button type="submit" disabled={disabled}>Audit this page</button>

      {/*
        A live region, because the message appears in response to submitting
        rather than to focus moving - a screen reader user who pressed Enter
        would otherwise get silence and a form that appeared to do nothing.
      */}
      <p id={errorId} role="alert">{problem}</p>

      <p id={previewId}>
        {preview === null ? null : <>Auditing <strong>{preview}</strong></>}
      </p>
    </form>
  )
}

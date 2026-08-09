import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Button, Callout, TextField} from '@chameleon-labs/lattice-react';
import {Link, useLocation, useNavigate} from 'react-router';
import {AlertCircle} from '@/screens/components/Icons';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {AuthShell} from '../../components/AuthShell';
import {PasswordField} from '../../components/PasswordField';
import {authFailureMessage} from '../../failure';
import {useSignup} from '../../mutations';
import {destinationFrom} from '../../return-to';
import {validateSignup, type Credentials} from '../../validation';
import './signup.css';

export const Signup = (): React.JSX.Element => {
  const [credentials, setCredentials] = useState<Credentials>({email: '', password: ''});
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const signup = useSignup();
  const location = useLocation();
  const navigate = useNavigate();
  const errors = submitted ? validateSignup(credentials) : {};

  useDocumentTitle('Create an account');

  useEffect(() => {
    if (signup.error !== null) {
      alertRef.current?.focus();
    }
  }, [signup.error]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);

    const nextErrors = validateSignup(credentials);
    if (nextErrors.email !== undefined) {
      emailRef.current?.focus();
      return;
    }
    if (nextErrors.password !== undefined) {
      passwordRef.current?.focus();
      return;
    }

    const succeeded = await signup.mutateAsync(credentials).then(
      () => true,
      () => false,
    );
    if (!succeeded) {
      return;
    }
    await navigate(destinationFrom(location.state), {replace: true});
  };

  return (
    <AuthShell
      title="Create an account"
      subtitle="Enter your details to get started."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state}>
            Log in
          </Link>
        </>
      }
    >
      {signup.error === null ? null : (
        <Callout ref={alertRef} tabIndex={-1} variant="danger" icon={<AlertCircle size="sm" />} live="assertive">
          {authFailureMessage(signup.error)}
        </Callout>
      )}
      <form className="signup-form" noValidate onSubmit={submit}>
        <TextField
          ref={emailRef}
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={credentials.email}
          {...(errors.email === undefined ? {} : {error: errors.email})}
          disabled={signup.isPending}
          onChange={(event) => {
            setCredentials((current) => ({...current, email: event.target.value}));
          }}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          description="12–200 characters"
          autoComplete="new-password"
          value={credentials.password}
          {...(errors.password === undefined ? {} : {error: errors.password})}
          disabled={signup.isPending}
          onChange={(event) => {
            setCredentials((current) => ({...current, password: event.target.value}));
          }}
        />
        <Button type="submit" variant="primary" disabled={signup.isPending}>
          {signup.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
};

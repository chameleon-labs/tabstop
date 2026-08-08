import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Button, Callout, TextField} from '@chameleon-labs/lattice-react';
import {Link, useLocation, useNavigate} from 'react-router';
import {AlertCircle} from '@/screens/components/Icons';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {AuthShell} from '../../components/AuthShell';
import {PasswordField} from '../../components/PasswordField';
import {authFailureMessage} from '../../failure';
import {useLogin} from '../../mutations';
import {destinationFrom} from '../../return-to';
import {validateLogin, type Credentials} from '../../validation';

export const Login = (): React.JSX.Element => {
  const [credentials, setCredentials] = useState<Credentials>({email: '', password: ''});
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const login = useLogin();
  const location = useLocation();
  const navigate = useNavigate();
  const errors = submitted ? validateLogin(credentials) : {};

  useDocumentTitle('Log in');

  useEffect(() => {
    if (login.error !== null) {
      alertRef.current?.focus();
    }
  }, [login.error]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitted(true);

    const nextErrors = validateLogin(credentials);
    if (nextErrors.email !== undefined) {
      emailRef.current?.focus();
      return;
    }
    if (nextErrors.password !== undefined) {
      passwordRef.current?.focus();
      return;
    }

    const succeeded = await login.mutateAsync(credentials).then(
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
      title="Log in"
      subtitle="Enter your details to continue."
      footer={
        <>
          New to tabstop? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      {login.error === null ? null : (
        <Callout
          ref={alertRef}
          tabIndex={-1}
          variant="danger"
          icon={<AlertCircle size="sm" />}
          live="assertive"
        >
          {authFailureMessage(login.error)}
        </Callout>
      )}
      <form noValidate onSubmit={submit}>
        <TextField
          ref={emailRef}
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={credentials.email}
          {...(errors.email === undefined ? {} : {error: errors.email})}
          disabled={login.isPending}
          onChange={(event) => {
            setCredentials((current) => ({...current, email: event.target.value}));
          }}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          autoComplete="current-password"
          value={credentials.password}
          {...(errors.password === undefined ? {} : {error: errors.password})}
          disabled={login.isPending}
          onChange={(event) => {
            setCredentials((current) => ({...current, password: event.target.value}));
          }}
        />
        <Button type="submit" variant="primary" disabled={login.isPending}>
          Log in
        </Button>
      </form>
    </AuthShell>
  );
};

import {useId, type ReactNode} from 'react';
import {Card, CardBody} from '@chameleon-labs/lattice-react';
import {Link} from 'react-router';
import './auth-shell.css';

export type AuthShellProps = {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
};

export const AuthShell = ({title, subtitle, footer, children}: AuthShellProps): React.JSX.Element => {
  const headingId = useId();

  return (
    <section className="auth-page" aria-labelledby={headingId}>
      <div className="auth-page__panel">
        <Link to="/" className="auth-page__brand" aria-label="tabstop home">
          <span className="auth-page__brand-mark" aria-hidden="true">t/</span>
          <span>tabstop</span>
        </Link>
        <h1 id={headingId}>{title}</h1>
        <p className="auth-page__subtitle">{subtitle}</p>
        <Card>
          <CardBody className="auth-page__card-body">{children}</CardBody>
        </Card>
        <p className="auth-page__footer">{footer}</p>
      </div>
    </section>
  );
};

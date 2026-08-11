import {Badge, Button} from '@chameleon-labs/lattice-react';
import {Link} from 'react-router';
import {BrandMark} from '../BrandMark';
import {AccountNavigation} from '@/screens/modules/account/components/AccountNavigation';
import type {LogoutMutation} from '@/screens/modules/account/mutations';
import './site-header.css';

/** An in-page anchor a screen wants offered in the header. */
export type HeaderSection = {
  id: string;
  label: string;
};

export type SiteHeaderProps = {
  /**
   * Data, not markup: a screen renders inside the outlet and cannot pass
   * children up to the layout above it, so these arrive via its route handle.
   */
  sections?: readonly HeaderSection[] | undefined;
  sessionFree?: boolean;
  logout: LogoutMutation;
};

/** The one header, on every route. Ported from the landing page's design. */
export const SiteHeader = ({sections, sessionFree = false, logout}: SiteHeaderProps): React.JSX.Element => (
  <header className="site-header">
    <div className="site-header__inner">
      <div className="site-header__brand">
        <Link to="/" className="site-header__home">
          <BrandMark size="sm" />
          <span className="site-header__wordmark">tabstop</span>
        </Link>
        <Badge variant="default">beta</Badge>
      </div>
      {sections === undefined || sections.length === 0 ? null : (
        <nav className="site-header__sections" aria-label="Page sections">
          {sections.map((section) => (
            <Button key={section.id} variant="link" size="sm" render={<a href={`#${section.id}`} />}>
              {section.label}
            </Button>
          ))}
        </nav>
      )}
      <AccountNavigation sessionFree={sessionFree} logout={logout} />
    </div>
  </header>
);

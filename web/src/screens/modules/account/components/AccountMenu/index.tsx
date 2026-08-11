import {Avatar, Callout, Menu, MenuButton, MenuItem, MenuProvider, MenuSeparator} from '@chameleon-labs/lattice-react';
import {useEffect, useRef} from 'react';
import {AlertCircle, Check} from '@/screens/components/Icons';
import {THEMES, type Theme} from '@/theme/theme';
import {useTheme} from '@/theme/use-theme';
import {authFailureMessage} from '../../failure';
import {useSignOut} from '../../hooks/use-sign-out';
import type {LogoutMutation} from '../../mutations';
import './account-menu.css';

const THEME_LABEL: Record<Theme, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

export type AccountMenuProps = {
  email: string;
  logout: LogoutMutation;
};

/**
 * `role="menuitemradio"` rather than Ariakit's `MenuItemRadio`, which Lattice
 * does not re-export: an unstyled part would look like a system component.
 */
export const AccountMenu = ({email, logout}: AccountMenuProps): React.JSX.Element => {
  const {theme, setTheme} = useTheme();
  const signOut = useSignOut(logout);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logout.error !== null) {
      alertRef.current?.focus();
    }
  }, [logout.error]);

  return (
    <>
      {logout.error === null ? null : (
        <Callout ref={alertRef} tabIndex={-1} variant="danger" icon={<AlertCircle size="sm" />} live="assertive">
          {authFailureMessage(logout.error)}
        </Callout>
      )}
      <MenuProvider>
        <MenuButton
          bare
          aria-label={`Account menu for ${email}`}
          render={<Avatar name={email} size="md" decorative />}
        />
        <Menu className="account-menu" gutter={8} unmountOnHide>
          <div className="account-menu__email" aria-hidden="true">
            {email}
          </div>
          <MenuSeparator />
          <div role="group" aria-label="Theme" className="account-menu__group">
            {THEMES.map((option) => (
              <MenuItem
                key={option}
                role="menuitemradio"
                aria-checked={theme === option}
                hideOnClick={false}
                onClick={() => {
                  setTheme(option);
                }}
              >
                {THEME_LABEL[option]}
                <span className="account-menu__check">{theme === option ? <Check size="sm" /> : null}</span>
              </MenuItem>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem
            hideOnClick={false}
            disabled={logout.isPending}
            onClick={() => {
              void signOut();
            }}
          >
            {logout.isPending ? 'Signing out…' : 'Log out'}
          </MenuItem>
        </Menu>
      </MenuProvider>
    </>
  );
};

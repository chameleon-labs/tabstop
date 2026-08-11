import {useCallback, useState} from 'react';
import {applyTheme, readStoredTheme, storeTheme, type Theme} from './theme';

export type ThemeControls = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

/**
 * No mount effect: the boot script has already stamped the document, and
 * re-applying here would hide it failing.
 */
export const useTheme = (): ThemeControls => {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const setTheme = useCallback((next: Theme): void => {
    storeTheme(next);
    applyTheme(next);
    setThemeState(next);
  }, []);

  return {theme, setTheme};
};

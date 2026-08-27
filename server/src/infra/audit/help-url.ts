export const HELP_ORIGIN = 'https://dequeuniversity.com';

export const safeHelpUrl = (helpUrl: unknown): string => {
  if (typeof helpUrl !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(helpUrl);
    return parsed.origin === HELP_ORIGIN ? parsed.href : '';
  } catch {
    return '';
  }
};

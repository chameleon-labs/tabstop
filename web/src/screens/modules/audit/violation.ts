export const FRAME_SEPARATOR = ' » ';

export const describeTarget = (target: readonly string[]): string => target.join(FRAME_SEPARATOR);

export const crossesFrames = (target: readonly string[]): boolean => target.length > 1;

export const HELP_ORIGIN = 'https://dequeuniversity.com';

export const safeHelpUrl = (helpUrl: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(helpUrl);
  } catch {
    return null;
  }

  return parsed.origin === HELP_ORIGIN ? parsed.href : null;
};

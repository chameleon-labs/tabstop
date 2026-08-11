export const RETURN_TO_KEY = 'from';

const LOCAL_ORIGIN = 'https://tabstop.invalid';
const FALLBACK = '/dashboard';

export const returnToSearch = (destination: string): string =>
  `?${new URLSearchParams({[RETURN_TO_KEY]: destination}).toString()}`;

export const destinationFrom = (search: string): string => {
  const destination = new URLSearchParams(search).get(RETURN_TO_KEY);

  if (destination === null || !destination.startsWith('/') || destination.startsWith('//')) {
    return FALLBACK;
  }
  if (destination.includes('\\')) {
    return FALLBACK;
  }
  if (new URL(destination, LOCAL_ORIGIN).origin !== LOCAL_ORIGIN) {
    return FALLBACK;
  }
  return destination;
};

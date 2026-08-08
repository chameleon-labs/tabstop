import {RETURN_TO_KEY} from './components/RequireAuth';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const destinationFrom = (state: unknown): string => {
  if (!isRecord(state)) {
    return '/dashboard';
  }

  const destination = state[RETURN_TO_KEY];
  if (typeof destination !== 'string' || !destination.startsWith('/') || destination.startsWith('//')) {
    return '/dashboard';
  }

  return destination;
};

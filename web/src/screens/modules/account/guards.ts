import type {AccountResponse} from '@tabstop/contract';
import type {QueryClient} from '@tanstack/react-query';
import {replace, type LoaderFunction} from 'react-router';
import {destinationFrom, returnToSearch} from './return-to';
import {sessionQueryOptions} from './session';

const SIGNED_OUT_REDIRECT = '/login';

const sessionOf = async (queryClient: QueryClient): Promise<AccountResponse | null> =>
  await queryClient.fetchQuery(sessionQueryOptions);

export const requireSession =
  (queryClient: QueryClient): LoaderFunction =>
  async ({url}): Promise<AccountResponse> => {
    const account = await sessionOf(queryClient);

    if (account === null) {
      throw replace(`${SIGNED_OUT_REDIRECT}${returnToSearch(`${url.pathname}${url.search}${url.hash}`)}`);
    }

    return account;
  };

export const requireAnonymous =
  (queryClient: QueryClient): LoaderFunction =>
  async ({url}): Promise<null> => {
    const account = await sessionOf(queryClient);

    if (account !== null) {
      throw replace(destinationFrom(url.search));
    }

    return null;
  };

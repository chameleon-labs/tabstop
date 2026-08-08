import type {AccountResponse} from '@tabstop/contract';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {post, request} from '@/api/client';
import {refreshSession} from './session';
import type {Credentials} from './validation';

const useCredentialMutation = (path: '/api/login' | '/api/signup') => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credentials: Credentials): Promise<AccountResponse> => {
      await post<AccountResponse>(path, credentials);
      const account = await refreshSession(queryClient);
      if (account === null) {
        throw new Error('Could not confirm your session');
      }
      return account;
    },
  });
};

export const useLogin = () => useCredentialMutation('/api/login');

export const useSignup = () => useCredentialMutation('/api/signup');

export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await request<null>('/api/logout', {method: 'POST'});
      queryClient.removeQueries();
      const account = await refreshSession(queryClient);
      if (account !== null) {
        throw new Error('Could not confirm that you signed out');
      }
    },
  });
};

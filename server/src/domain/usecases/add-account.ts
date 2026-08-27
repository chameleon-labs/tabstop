import type {AuthenticatedSession} from '../models/session.js';

export type AddAccountParams = {
  email: string;
  password: string;
};

export interface AddAccount {
  add: (params: AddAccountParams) => Promise<AuthenticatedSession | null>;
}

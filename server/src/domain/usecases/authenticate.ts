import type {AuthenticatedSession} from '../models/session.js';

export type AuthenticateParams = {
  email: string;
  password: string;
};

export interface Authenticate {
  auth: (params: AuthenticateParams) => Promise<AuthenticatedSession | null>;
}

import type {UrlRejection} from '../../domain/services/url-safety.js';

export const REJECTION_MESSAGES: Readonly<Record<UrlRejection, string>> = {
  'invalid-url': 'That does not look like a URL',
  'blocked-scheme': 'Only http and https addresses can be audited',
  'blocked-port': 'Only standard web ports can be audited',
  'blocked-address': "That address can't be audited",
  'blocked-credentials': 'Remove the username and password from that URL',
};

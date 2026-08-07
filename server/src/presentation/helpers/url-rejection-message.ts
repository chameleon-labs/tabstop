import type {UrlRejection} from '../../domain/services/url-safety.js';

/**
 * One table, shared by every endpoint that accepts a url from a user.
 *
 * `blocked-address` reuses the worker's wording deliberately. A
 * submission-time rejection and an audit-time one must read identically, or
 * the difference tells an attacker which internal addresses exist - and two
 * copies of this table is exactly how that guarantee erodes, one endpoint at
 * a time, with nothing to notice.
 */
export const REJECTION_MESSAGES: Readonly<Record<UrlRejection, string>> = {
  'invalid-url': 'That does not look like a URL',
  'blocked-scheme': 'Only http and https addresses can be audited',
  'blocked-port': 'Only standard web ports can be audited',
  'blocked-address': "That address can't be audited",
  'blocked-credentials': 'Remove the username and password from that URL',
};

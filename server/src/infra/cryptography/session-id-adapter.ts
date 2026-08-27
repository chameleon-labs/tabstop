import {randomBytes} from 'node:crypto';
import type {SessionIdGenerator} from '../../data/protocols/cryptography/session-id-generator.js';

const SESSION_ID_BYTES = 32;

export class SessionIdAdapter implements SessionIdGenerator {
  generate(): string {
    return randomBytes(SESSION_ID_BYTES).toString('hex');
  }
}

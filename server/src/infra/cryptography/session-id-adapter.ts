import { randomBytes } from 'node:crypto'
import type { SessionIdGenerator } from '../../data/protocols/cryptography/session-id-generator.js'

const SESSION_ID_BYTES = 32

/** 256 bits of entropy, hex-encoded so the cookie needs no percent-escaping. */
export class SessionIdAdapter implements SessionIdGenerator {
  generate (): string {
    return randomBytes(SESSION_ID_BYTES).toString('hex')
  }
}

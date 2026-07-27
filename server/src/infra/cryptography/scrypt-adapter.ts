import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Hasher } from '../../data/protocols/cryptography/hasher.js'
import type { HashComparer } from '../../data/protocols/cryptography/hash-comparer.js'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number, r: number, p: number, maxmem: number }
) => Promise<Buffer>

const KEY_LENGTH = 64
const SALT_LENGTH = 16
const BLOCK_SIZE = 8
const PARALLELISATION = 1

/**
 * Node's default maxmem rejects any cost above N=16384 with `Invalid scrypt
 * params` - at runtime, not compile time. It has to be raised explicitly for
 * the cost this adapter actually uses.
 */
const MAX_MEMORY = 256 * 1024 * 1024

const DIGEST_PARTS = 6

/**
 * scrypt (RFC 7914) from the standard library. Chosen over argon2 and bcrypt
 * because both are native modules needing a prebuilt binary or node-gyp per
 * platform and Node ABI - across macOS development, CI, and a deploy image
 * already carrying Playwright and Chromium.
 *
 * The digest is self-describing:
 *
 *     scrypt$N$r$p$<salt-base64>$<key-base64>
 *
 * so the cost can be raised later without a migration and without invalidating
 * existing passwords: verification reads the parameters from the stored string
 * rather than from configuration.
 */
export class ScryptAdapter implements Hasher, HashComparer {
  constructor (private readonly cost: number) {}

  async hash (plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH)
    const key = await scryptAsync(plaintext, salt, KEY_LENGTH, {
      N: this.cost, r: BLOCK_SIZE, p: PARALLELISATION, maxmem: MAX_MEMORY
    })
    return [
      'scrypt', this.cost, BLOCK_SIZE, PARALLELISATION,
      salt.toString('base64'), key.toString('base64')
    ].join('$')
  }

  async compare (plaintext: string, digest: string): Promise<boolean> {
    const parts = digest.split('$')
    if (parts.length !== DIGEST_PARTS) return false

    const [scheme, n, r, p, saltBase64, keyBase64] = parts
    if (scheme !== 'scrypt') return false
    if (n === undefined || r === undefined || p === undefined) return false
    if (saltBase64 === undefined || keyBase64 === undefined) return false

    const parameters = { N: Number(n), r: Number(r), p: Number(p) }
    if (!Object.values(parameters).every(Number.isInteger)) return false

    const expected = Buffer.from(keyBase64, 'base64')
    if (expected.length === 0) return false

    // Derived at the STORED digest's length, not at KEY_LENGTH: timingSafeEqual
    // throws RangeError on unequal-length buffers, so a digest written with
    // different parameters would throw instead of returning false.
    const actual = await scryptAsync(
      plaintext, Buffer.from(saltBase64, 'base64'), expected.length,
      { ...parameters, maxmem: MAX_MEMORY }
    )

    return timingSafeEqual(actual, expected)
  }
}

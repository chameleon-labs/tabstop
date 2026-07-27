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
 * Node validates scrypt parameters synchronously and THROWS, so "a positive
 * integer" is not a sufficient check: N must be a power of two above 1, and the
 * derivation must fit within maxmem. Verified - N=3 and N=262144 both raise
 * ERR_CRYPTO_INVALID_SCRYPT_PARAMS, and N=-1 raises ERR_OUT_OF_RANGE.
 *
 * The memory predicate is `128 * r * (N + p)`, not `128 * r * N`. The
 * difference decides the boundary case: at N=262144, r=8 the naive form equals
 * maxmem exactly and would be accepted, while Node rejects it. Measured across
 * N and p, this form separates every accepted case from every rejected one.
 *
 * Exported because the environment schema validates SCRYPT_COST with it at
 * boot: a cost that passes a naive check and then fails on every hash turns
 * signup into a 500 while login keeps working, which is exactly the kind of
 * partial breakage the fail-fast config rule exists to prevent.
 */
export const isValidScryptCost = (
  cost: number, blockSize = BLOCK_SIZE, parallelisation = PARALLELISATION
): boolean =>
  Number.isInteger(cost) &&
  cost > 1 &&
  (cost & (cost - 1)) === 0 &&
  128 * blockSize * (cost + parallelisation) <= MAX_MEMORY

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
    const expected = Buffer.from(keyBase64, 'base64')
    if (expected.length === 0) return false

    // Parameter validity is left to scrypt itself rather than re-checked here.
    // Node validates synchronously and throws - for a cost that is not a power
    // of two, one that exceeds maxmem, a negative one, or NaN - and this
    // method's contract is that a bad digest is a false, never an exception
    // escaping to the caller as a 500. Duplicating the rules here would add a
    // second place to get them wrong without changing any outcome.
    try {
      // Derived at the STORED digest's length, not at KEY_LENGTH:
      // timingSafeEqual throws RangeError on unequal-length buffers, so a
      // digest written with different parameters would throw instead of
      // returning false.
      const actual = await scryptAsync(
        plaintext, Buffer.from(saltBase64, 'base64'), expected.length,
        { ...parameters, maxmem: MAX_MEMORY }
      )

      return timingSafeEqual(actual, expected)
    } catch {
      // Backstop for any parameter combination the checks above do not
      // anticipate. Failing closed is the only safe direction here.
      return false
    }
  }
}

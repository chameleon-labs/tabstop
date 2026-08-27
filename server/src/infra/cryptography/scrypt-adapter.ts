import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import type {Hasher} from '../../data/protocols/cryptography/hasher.js';
import type {HashComparer} from '../../data/protocols/cryptography/hash-comparer.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: {N: number; r: number; p: number; maxmem: number},
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const BLOCK_SIZE = 8;

const PARALLELISATION = 3;

const MAX_MEMORY = 256 * 1024 * 1024;

const DIGEST_PARTS = 6;

export const isValidScryptCost = (cost: number, blockSize = BLOCK_SIZE, parallelisation = PARALLELISATION): boolean =>
  Number.isInteger(cost) &&
  cost > 1 &&
  (cost & (cost - 1)) === 0 &&
  128 * blockSize * (cost + parallelisation) <= MAX_MEMORY;

export class ScryptAdapter implements Hasher, HashComparer {
  constructor(private readonly cost: number) {}

  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await scryptAsync(plaintext, salt, KEY_LENGTH, {
      N: this.cost,
      r: BLOCK_SIZE,
      p: PARALLELISATION,
      maxmem: MAX_MEMORY,
    });
    return ['scrypt', this.cost, BLOCK_SIZE, PARALLELISATION, salt.toString('base64'), key.toString('base64')].join(
      '$',
    );
  }

  async compare(plaintext: string, digest: string): Promise<boolean> {
    const parts = digest.split('$');
    if (parts.length !== DIGEST_PARTS) {
      return false;
    }

    const [scheme, n, r, p, saltBase64, keyBase64] = parts;
    if (scheme !== 'scrypt') {
      return false;
    }
    if (n === undefined || r === undefined || p === undefined) {
      return false;
    }
    if (saltBase64 === undefined || keyBase64 === undefined) {
      return false;
    }

    const parameters = {N: Number(n), r: Number(r), p: Number(p)};
    const expected = Buffer.from(keyBase64, 'base64');
    if (expected.length !== KEY_LENGTH) {
      return false;
    }

    try {
      const actual = await scryptAsync(plaintext, Buffer.from(saltBase64, 'base64'), KEY_LENGTH, {
        ...parameters,
        maxmem: MAX_MEMORY,
      });

      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}

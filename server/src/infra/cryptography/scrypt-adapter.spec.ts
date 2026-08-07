import {describe, expect, it} from 'vitest';
import {ScryptAdapter, isValidScryptCost} from './scrypt-adapter.js';

// 16384 is the highest cost Node accepts on its default maxmem, and keeps the
// suite fast. Production runs 32768 via SCRYPT_COST.
const COST = 16384;

const makeSut = (cost = COST): ScryptAdapter => new ScryptAdapter(cost);

describe('ScryptAdapter', () => {
  describe('hash', () => {
    it('produces a self-describing digest that is not the plaintext', async () => {
      const digest = await makeSut().hash('correct horse battery staple');

      expect(digest).not.toContain('correct horse');
      expect(digest.startsWith(`scrypt$${COST}$8$3$`)).toBe(true);
    });

    it('salts, so the same password hashes differently every time', async () => {
      const sut = makeSut();

      expect(await sut.hash('same')).not.toBe(await sut.hash('same'));
    });
  });

  describe('compare', () => {
    it('verifies a correct password and rejects a wrong one', async () => {
      const sut = makeSut();
      const digest = await sut.hash('correct horse battery staple');

      expect(await sut.compare('correct horse battery staple', digest)).toBe(true);
      expect(await sut.compare('wrong password entirely', digest)).toBe(false);
    });

    it('verifies a digest written at a different cost', async () => {
      // The reason the digest carries its own parameters: raising the default
      // must not invalidate every password already stored.
      const oldDigest = await makeSut(8192).hash('legacy password');

      expect(await makeSut(COST).compare('legacy password', oldDigest)).toBe(true);
    });

    it('verifies a digest written at the old parallelisation of 1', async () => {
      // The parallelisation moved from 1 to 3 to meet OWASP's 2^15/8/3
      // configuration. Digests written before that carry p=1 and must keep
      // verifying - which is exactly what the self-describing format is for.
      const sut = makeSut();
      const legacy = `scrypt$${COST}$8$1$${'a'.repeat(24)}$`;

      // built by hand at p=1, then verified through the current adapter
      const {scryptSync} = await import('node:crypto');
      const salt = Buffer.from('a'.repeat(24), 'base64');
      const key = scryptSync('legacy password', salt, 64, {
        N: COST,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
      });

      expect(await sut.compare('legacy password', legacy + key.toString('base64'))).toBe(true);
      expect(await sut.compare('wrong password', legacy + key.toString('base64'))).toBe(false);
    });

    it('returns false for structurally malformed digests instead of throwing', async () => {
      const sut = makeSut();

      for (const malformed of [
        '',
        'garbage',
        'scrypt$1$2',
        'bcrypt$16384$8$1$YQ==$YQ==',
        'scrypt$x$8$1$YQ==$YQ==',
        'scrypt$16384$8$1$YQ==$',
      ]) {
        expect(await sut.compare('anything', malformed)).toBe(false);
      }
    });

    it('rejects a truncated digest rather than comparing only the bytes it kept', async () => {
      // Deriving at the STORED key length made a truncated digest fail OPEN:
      // a one-byte key compares one byte, so roughly 1 in 256 arbitrary
      // passwords was accepted. Measured at 3 of 1500 before the length check.
      const sut = makeSut();
      const digest = await sut.hash('the real password');
      const [scheme, n, r, p, salt, key] = digest.split('$');
      const truncate = (bytes: number): string =>
        [
          scheme,
          n,
          r,
          p,
          salt,
          Buffer.from(key ?? '', 'base64')
            .subarray(0, bytes)
            .toString('base64'),
        ].join('$');

      for (const bytes of [1, 2, 8, 32, 63]) {
        expect(await sut.compare('the real password', truncate(bytes))).toBe(false);
        for (let attempt = 0; attempt < 40; attempt++) {
          expect(await sut.compare(`wrong-${attempt}`, truncate(bytes))).toBe(false);
        }
      }

      // and the untruncated digest still verifies
      expect(await sut.compare('the real password', digest)).toBe(true);
    });

    it('returns false for a digest whose parameters scrypt itself rejects', async () => {
      // These parse cleanly and pass a naive Number.isInteger check, then make
      // Node throw synchronously - ERR_CRYPTO_INVALID_SCRYPT_PARAMS for a cost
      // that is not a power of two or exceeds maxmem, ERR_OUT_OF_RANGE for a
      // negative one. The contract here is a false, never a 500.
      const sut = makeSut();

      for (const rejected of [
        'scrypt$3$8$1$YQ==$YQ==',
        'scrypt$-1$8$1$YQ==$YQ==',
        'scrypt$262144$8$1$YQ==$YQ==',
        'scrypt$16384$0$1$YQ==$YQ==',
        'scrypt$16384$8$0$YQ==$YQ==',
      ]) {
        expect(await sut.compare('anything', rejected)).toBe(false);
      }
    });
  });
});

describe('isValidScryptCost', () => {
  it('accepts the costs this project actually uses', () => {
    expect(isValidScryptCost(16384)).toBe(true);
    expect(isValidScryptCost(32768)).toBe(true);
    expect(isValidScryptCost(131072)).toBe(true);
  });

  it('rejects costs that are positive integers but unusable', () => {
    expect(isValidScryptCost(20000)).toBe(false); // not a power of two
    expect(isValidScryptCost(0)).toBe(false);
    expect(isValidScryptCost(1)).toBe(false);
    expect(isValidScryptCost(-1024)).toBe(false);
    expect(isValidScryptCost(1024.5)).toBe(false);
  });

  it('rejects the boundary cost that a naive memory check would allow', () => {
    // 128 * r * N at N=262144, r=8 equals maxmem exactly, so `<= maxmem` on
    // that form accepts it - and Node then throws. The predicate has to be
    // 128 * r * (N + p). Measured against Node across N and p.
    expect(isValidScryptCost(262144)).toBe(false);
  });
});

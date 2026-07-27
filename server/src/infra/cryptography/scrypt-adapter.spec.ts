import { describe, expect, it } from 'vitest'
import { ScryptAdapter } from './scrypt-adapter.js'

// 16384 is the highest cost Node accepts on its default maxmem, and keeps the
// suite fast. Production runs 32768 via SCRYPT_COST.
const COST = 16384

const makeSut = (cost = COST): ScryptAdapter => new ScryptAdapter(cost)

describe('ScryptAdapter', () => {
  describe('hash', () => {
    it('produces a self-describing digest that is not the plaintext', async () => {
      const digest = await makeSut().hash('correct horse battery staple')

      expect(digest).not.toContain('correct horse')
      expect(digest.startsWith(`scrypt$${COST}$8$1$`)).toBe(true)
    })

    it('salts, so the same password hashes differently every time', async () => {
      const sut = makeSut()

      expect(await sut.hash('same')).not.toBe(await sut.hash('same'))
    })
  })

  describe('compare', () => {
    it('verifies a correct password and rejects a wrong one', async () => {
      const sut = makeSut()
      const digest = await sut.hash('correct horse battery staple')

      expect(await sut.compare('correct horse battery staple', digest)).toBe(true)
      expect(await sut.compare('wrong password entirely', digest)).toBe(false)
    })

    it('verifies a digest written at a different cost', async () => {
      // The reason the digest carries its own parameters: raising the default
      // must not invalidate every password already stored.
      const oldDigest = await makeSut(8192).hash('legacy password')

      expect(await makeSut(COST).compare('legacy password', oldDigest)).toBe(true)
    })

    it('returns false for malformed digests instead of throwing', async () => {
      // timingSafeEqual throws RangeError on unequal-length buffers, which is
      // why the candidate key is derived at the STORED digest's length. Without
      // that, these inputs crash rather than fail closed.
      const sut = makeSut()

      for (const malformed of [
        '', 'garbage', 'scrypt$1$2', 'bcrypt$16384$8$1$YQ==$YQ==',
        'scrypt$x$8$1$YQ==$YQ==', 'scrypt$16384$8$1$YQ==$'
      ]) {
        expect(await sut.compare('anything', malformed)).toBe(false)
      }
    })
  })
})

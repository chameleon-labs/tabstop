import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts'],
    globalSetup: ['./vitest.globalSetup.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main/**', 'src/**/*.{spec,test}.ts', 'src/**/protocols/**', 'src/**/mocks/**', 'src/**/test/**']
    }
  }
})

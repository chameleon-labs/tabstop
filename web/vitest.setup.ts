import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom is shared across the tests in a file, so a component left mounted keeps
// its DOM - and its live regions - visible to the next test's queries.
afterEach(() => { cleanup() })

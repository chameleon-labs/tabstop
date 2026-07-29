import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSessionSweeper } from './session-sweeper.js'

type DeleteExpired = () => Promise<number>

const mockSessions = (
  deleteExpired: DeleteExpired = async () => 0
) => ({ deleteExpired: vi.fn<DeleteExpired>(deleteExpired) })

describe('startSessionSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not sweep on boot', async () => {
    // A worker restarting in a crash loop would otherwise issue a table-wide
    // delete on every start - which is precisely when the database is least
    // likely to want one.
    const sessions = mockSessions()

    const sweeper = startSessionSweeper(sessions, 1000)

    expect(sessions.deleteExpired).not.toHaveBeenCalled()
    sweeper.stop()
  })

  it('sweeps once per interval', async () => {
    const sessions = mockSessions()
    const sweeper = startSessionSweeper(sessions, 1000)

    await vi.advanceTimersByTimeAsync(3000)

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(3)
    sweeper.stop()
  })

  it('keeps sweeping after a failure', async () => {
    // Failing to tidy up must never take the worker down, and the next pass
    // finds the same rows still waiting.
    const sessions = mockSessions(async () => { throw new Error('database down') })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sweeper = startSessionSweeper(sessions, 1000)

    await vi.advanceTimersByTimeAsync(2000)

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(2)
    sweeper.stop()
  })

  it('never runs two sweeps at once, however long one takes', async () => {
    // The failure this prevents: on a fixed interval, a delete that outlasts
    // the period has a second delete start on top of it, then a third. Each
    // holds a pool connection, and it is the same pool the audit jobs need -
    // so the cleanup task starves the work the process exists to do, and it
    // does so exactly when the table is big enough for the delete to be slow.
    let release = (): void => undefined
    const blocked = new Promise<number>((resolve) => {
      release = () => { resolve(0) }
    })
    const sessions = mockSessions(async () => await blocked)

    const sweeper = startSessionSweeper(sessions, 1000)
    // Ten periods pass while the first sweep is still in flight.
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(1)

    // And once it finishes, sweeping resumes rather than stopping for good.
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sessions.deleteExpired).toHaveBeenCalledTimes(2)

    sweeper.stop()
  })

  it('stops when told to', async () => {
    const sessions = mockSessions()
    const sweeper = startSessionSweeper(sessions, 1000)

    await vi.advanceTimersByTimeAsync(1000)
    sweeper.stop()
    await vi.advanceTimersByTimeAsync(5000)

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(1)
  })
})

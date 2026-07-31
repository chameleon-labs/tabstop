import { RateLimitError, type Job } from 'bullmq'
import { AlertRateLimitError } from '../../data/protocols/mail/alert-sender.js'
import type {
  AlertEmailDispatchSummary, DispatchPendingAlertEmails
} from '../../domain/usecases/dispatch-pending-alert-emails.js'
import type {
  SendAlertEmail, SendAlertEmailOutcome
} from '../../domain/usecases/send-alert-email.js'
import type { AlertQueuePayload } from '../config/queue-names.js'

type AlertEmailJob = Pick<Job<AlertQueuePayload, void, string>, 'data' | 'attemptsMade'>

type AlertEmailJobProcessorDependencies = {
  rateLimit: (durationMs: number) => Promise<void>
  dispatch: DispatchPendingAlertEmails['dispatch']
  send: SendAlertEmail['send']
}

export const ALERT_EMAIL_WORKER_LIMITER = { max: 10, duration: 1000 }

const logDispatch = (summary: AlertEmailDispatchSummary): void => {
  console.log(JSON.stringify({ event: 'alert-email-dispatch', ...summary }))
}

const logSend = (
  alertEventId: string,
  outcome: SendAlertEmailOutcome,
  attempt: number
): void => {
  console.log(JSON.stringify({
    event: 'alert-email-send',
    alertEventId,
    outcome,
    attempt
  }))
}

export const makeAlertEmailJobProcessor = ({
  rateLimit,
  dispatch,
  send
}: AlertEmailJobProcessorDependencies) => async (job: AlertEmailJob): Promise<void> => {
  if (job.data.kind === 'dispatch') {
    logDispatch(await dispatch())
    return
  }

  try {
    const outcome = await send(job.data.alertEventId)
    logSend(job.data.alertEventId, outcome, job.attemptsMade + 1)
  } catch (error) {
    if (error instanceof AlertRateLimitError) {
      await rateLimit(error.retryAfterMs)
      throw new RateLimitError()
    }
    throw error
  }
}

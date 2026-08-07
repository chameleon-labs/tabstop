import {DbDispatchPendingAlertEmails} from '../../../../data/usecases/alert/dispatch-pending-alert-emails.js';
import {DbSendAlertEmail} from '../../../../data/usecases/alert/send-alert-email.js';
import type {AlertDispatchMode} from '../../../../data/protocols/db/alert-event/load-pending-alert-events-repository.js';
import type {DispatchPendingAlertEmails} from '../../../../domain/usecases/dispatch-pending-alert-emails.js';
import type {SendAlertEmail} from '../../../../domain/usecases/send-alert-email.js';
import type {AlertQueuePayload} from '../../../config/queue-names.js';
import {HmacAlertUnsubscribeToken} from '../../../../infra/cryptography/hmac-alert-unsubscribe-token.js';
import {PostgresAlertEventRepository} from '../../../../infra/db/postgres/alert-event/postgres-alert-event-repository.js';
import {BullMqAlertEmailQueue} from '../../../../infra/queue/bullmq-alert-email-queue.js';
import type {PayloadQueue} from '../../../../infra/queue/helpers/bullmq-helper.js';
import {getDatabase} from '../../../config/database.js';
import {env} from '../../../config/env.js';
import {makeAlertSender} from '../../mail/alert-sender-factory.js';

export const alertDispatchMode = (mailDriver: typeof env.mailDriver): AlertDispatchMode =>
  mailDriver === 'console' ? 'preview' : 'delivery';

export const makeDispatchPendingAlertEmails = (queue: PayloadQueue<AlertQueuePayload>): DispatchPendingAlertEmails =>
  new DbDispatchPendingAlertEmails(
    new PostgresAlertEventRepository(getDatabase()),
    new BullMqAlertEmailQueue(queue, env.mailDriver === 'resend'),
    undefined,
    alertDispatchMode(env.mailDriver),
  );

export const makeSendAlertEmail = (): SendAlertEmail =>
  new DbSendAlertEmail(
    new PostgresAlertEventRepository(getDatabase()),
    makeAlertSender(),
    new HmacAlertUnsubscribeToken(env.alertUnsubscribeSecret),
    env.mailFrom,
    env.frontendOrigin,
    env.publicApiOrigin,
    alertDispatchMode(env.mailDriver),
  );

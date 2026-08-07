import type {UnsubscribePageAlerts} from '../../../domain/usecases/unsubscribe-page-alerts.js';
import {badRequest, notFound, okHtml} from '../../helpers/http/http-helper.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type UnsubscribePageAlertsRequest = {
  token?: unknown;
  'List-Unsubscribe'?: unknown;
};

export class UnsubscribePageAlertsController implements Controller<UnsubscribePageAlertsRequest> {
  constructor(private readonly unsubscribePageAlerts: UnsubscribePageAlerts) {}

  async handle(request: UnsubscribePageAlertsRequest): Promise<HttpResponse> {
    if (typeof request.token !== 'string' || request['List-Unsubscribe'] !== 'One-Click') {
      return badRequest(new Error('Invalid one-click unsubscribe request'));
    }

    if (!(await this.unsubscribePageAlerts.unsubscribe(request.token))) {
      return notFound(new Error('Unsubscribe link not found'));
    }

    return okHtml(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alerts disabled — Tabstop</title>
</head>
<body>
  <main>
    <h1>Alerts are off</h1>
    <p>Daily accessibility monitoring and history will continue for this page.</p>
  </main>
</body>
</html>`);
  }
}

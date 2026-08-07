import {notFound, okHtml} from '../../helpers/http/http-helper.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type AlertUnsubscribeConfirmationRequest = {
  token?: unknown;
};

const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export class AlertUnsubscribeConfirmationController implements Controller<AlertUnsubscribeConfirmationRequest> {
  handle(request: AlertUnsubscribeConfirmationRequest): Promise<HttpResponse> {
    if (typeof request.token !== 'string') {
      return Promise.resolve(notFound(new Error('Unsubscribe link not found')));
    }

    const action = `/api/alerts/unsubscribe/${escapeAttribute(request.token)}`;
    return Promise.resolve(
      okHtml(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stop page alerts — Tabstop</title>
</head>
<body>
  <main>
    <h1>Stop alerts for this page?</h1>
    <p>Daily accessibility monitoring and history will continue.</p>
    <form method="post" action="${action}">
      <input type="hidden" name="List-Unsubscribe" value="One-Click">
      <button type="submit">Stop alerts</button>
    </form>
  </main>
</body>
</html>`),
    );
  }
}

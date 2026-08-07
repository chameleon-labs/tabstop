import {describe, expect, it, vi} from 'vitest';
import type {UnsubscribePageAlerts} from '../../../domain/usecases/unsubscribe-page-alerts.js';
import {UnsubscribePageAlertsController} from './unsubscribe-page-alerts-controller.js';

describe('UnsubscribePageAlertsController', () => {
  it('accepts the RFC 8058 one-click form without authentication', async () => {
    const unsubscribe: UnsubscribePageAlerts = {
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    const sut = new UnsubscribePageAlertsController(unsubscribe);

    const response = await sut.handle({
      token: 'signed',
      'List-Unsubscribe': 'One-Click',
    });

    expect(unsubscribe.unsubscribe).toHaveBeenCalledWith('signed');
    expect(response).toMatchObject({statusCode: 200, bodyType: 'html'});
    expect(response.body).toContain('Alerts are off');
  });

  it('rejects a request that does not carry the one-click form value', async () => {
    const unsubscribe: UnsubscribePageAlerts = {
      unsubscribe: vi.fn(),
    };
    const response = await new UnsubscribePageAlertsController(unsubscribe).handle({
      token: 'signed',
    });

    expect(response.statusCode).toBe(400);
    expect(unsubscribe.unsubscribe).not.toHaveBeenCalled();
  });

  it('returns the same not-found response for a tampered token and a deleted page', async () => {
    const unsubscribe: UnsubscribePageAlerts = {
      unsubscribe: vi.fn().mockResolvedValue(false),
    };
    const response = await new UnsubscribePageAlertsController(unsubscribe).handle({
      token: 'bad',
      'List-Unsubscribe': 'One-Click',
    });

    expect(response).toEqual({
      statusCode: 404,
      body: {error: 'Unsubscribe link not found'},
    });
  });
});

import {
  AlertUnsubscribeConfirmationController,
  type AlertUnsubscribeConfirmationRequest,
} from '../../../../presentation/controllers/alert/alert-unsubscribe-confirmation-controller.js';
import {
  UnsubscribePageAlertsController,
  type UnsubscribePageAlertsRequest,
} from '../../../../presentation/controllers/alert/unsubscribe-page-alerts-controller.js';
import type {Controller} from '../../../../presentation/protocols/controller.js';
import {makeUnsubscribePageAlerts} from '../../usecases/alert/alert-usecase-factories.js';

export const makeAlertUnsubscribeConfirmationController = (): Controller<AlertUnsubscribeConfirmationRequest> =>
  new AlertUnsubscribeConfirmationController();

export const makeUnsubscribePageAlertsController = (): Controller<UnsubscribePageAlertsRequest> =>
  new UnsubscribePageAlertsController(makeUnsubscribePageAlerts());

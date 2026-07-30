import {
  AddPageController, type AddPageRequest
} from '../../../../presentation/controllers/page/add-page-controller.js'
import {
  DeletePageController, type DeletePageRequest
} from '../../../../presentation/controllers/page/delete-page-controller.js'
import {
  LoadPageHistoryController, type LoadPageHistoryRequest
} from '../../../../presentation/controllers/page/load-page-history-controller.js'
import {
  LoadPagesController, type LoadPagesRequest
} from '../../../../presentation/controllers/page/load-pages-controller.js'
import {
  UpdatePageController, type UpdatePageRequest
} from '../../../../presentation/controllers/page/update-page-controller.js'
import type { Controller } from '../../../../presentation/protocols/controller.js'
import {
  makeAddPage, makeDeletePage, makeLoadPageHistory, makeLoadPages, makeUpdatePage
} from '../../usecases/page/page-usecase-factories.js'
import {
  makeAddPageValidation, makeLoadPageHistoryValidation, makeUpdatePageValidation
} from '../../validation/page-validation-factory.js'

export const makeAddPageController = (): Controller<AddPageRequest> =>
  new AddPageController(makeAddPageValidation(), makeAddPage())

export const makeLoadPagesController = (): Controller<LoadPagesRequest> =>
  new LoadPagesController(makeLoadPages())

export const makeLoadPageHistoryController = (): Controller<LoadPageHistoryRequest> =>
  new LoadPageHistoryController(makeLoadPageHistoryValidation(), makeLoadPageHistory())

export const makeUpdatePageController = (): Controller<UpdatePageRequest> =>
  new UpdatePageController(makeUpdatePageValidation(), makeUpdatePage())

export const makeDeletePageController = (): Controller<DeletePageRequest> =>
  new DeletePageController(makeDeletePage())

import {
  AddPageController
} from '../../../../presentation/controllers/page/add-page-controller.js'
import {
  DeletePageController
} from '../../../../presentation/controllers/page/delete-page-controller.js'
import {
  LoadPagesController
} from '../../../../presentation/controllers/page/load-pages-controller.js'
import {
  UpdatePageController
} from '../../../../presentation/controllers/page/update-page-controller.js'
import type { Controller } from '../../../../presentation/protocols/controller.js'
import {
  makeAddPage, makeDeletePage, makeLoadPages, makeUpdatePage
} from '../../usecases/page/page-usecase-factories.js'
import {
  makeAddPageValidation, makeUpdatePageValidation
} from '../../validation/page-validation-factory.js'

export const makeAddPageController = (): Controller =>
  new AddPageController(makeAddPageValidation(), makeAddPage()) as Controller

export const makeLoadPagesController = (): Controller =>
  new LoadPagesController(makeLoadPages()) as Controller

export const makeUpdatePageController = (): Controller =>
  new UpdatePageController(makeUpdatePageValidation(), makeUpdatePage()) as Controller

export const makeDeletePageController = (): Controller =>
  new DeletePageController(makeDeletePage()) as Controller

import type { Request, Response } from 'express'
import type { Controller } from '../../presentation/protocols/controller.js'

export const adaptRoute = (controller: Controller) => {
  return async (req: Request, res: Response): Promise<void> => {
    const httpRequest = { ...req.body, ...req.params, ...req.query }
    const httpResponse = await controller.handle(httpRequest)
    res.status(httpResponse.statusCode).json(httpResponse.body)
  }
}

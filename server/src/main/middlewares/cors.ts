import type { NextFunction, Request, Response } from 'express'

export const cors = (req: Request, res: Response, next: NextFunction): void => {
  res.set('access-control-allow-origin', '*')
  res.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE')
  res.set('access-control-allow-headers', '*')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  next()
}

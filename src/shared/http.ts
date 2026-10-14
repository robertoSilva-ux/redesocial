import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express não propaga rejeições de Promise para o error handler sozinho;
// este wrapper garante que qualquer erro lançado (ex.: UserNotFoundError)
// chegue ao errorHandler.ts em vez de derrubar o processo.
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

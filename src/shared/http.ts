import type { NextFunction, Request, RequestHandler, Response } from 'express';

// A mesma rota serve navegador (formulário EJS → redirect) e cliente JS
// (fetch → JSON): quem decide é o header `Accept`. Usado pelo errorHandler
// (HTML x JSON) e pelas rotas de interação (curtir, comentar).
export function wantsJson(req: Request): boolean {
  return req.accepts(['html', 'json']) === 'json';
}

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

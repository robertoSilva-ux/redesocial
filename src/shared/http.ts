import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ValidationError } from './errors.js';

// A mesma rota serve navegador (formulário EJS → redirect) e cliente JS
// (fetch → JSON): quem decide é o header `Accept`. Usado pelo errorHandler
// (HTML x JSON) e pelas rotas de interação (curtir, comentar).
export function wantsJson(req: Request): boolean {
  return req.accepts(['html', 'json']) === 'json';
}

/**
 * Responde um erro respeitando o cliente: JSON para quem pediu JSON (o
 * `fetch` do feed manda `Accept: application/json`), página de erro para o
 * formulário. Usado pelos middlewares de autorização, que antes devolviam
 * sempre HTML — errado para uma chamada de `fetch`.
 */
export function sendError(req: Request, res: Response, status: number, message: string): void {
  if (wantsJson(req)) {
    res.status(status).json({ error: message });
    return;
  }
  res.status(status).render('error', { status, message });
}

/**
 * Converte `:id` da rota em número inteiro positivo.
 *
 * Sem isso, `GET /api/posts/abc` entregava `NaN` ao Prisma, que estourava um
 * `PrismaClientValidationError` — 500 com o stack e o caminho do projeto no
 * corpo da resposta (achado da revisão, cartão E0b). Id inválido é erro do
 * cliente: 400.
 */
export function parseIdParam(raw: string | undefined, label = 'id'): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new ValidationError(`"${label}" deve ser um número inteiro positivo`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`"${label}" deve ser um número inteiro positivo`);
  }
  return value;
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

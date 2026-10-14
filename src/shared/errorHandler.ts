import type { NextFunction, Request, Response } from 'express';
import {
  DuplicateEmailError,
  DuplicateFollowError,
  PostNotFoundError,
  SelfFollowError,
  TagNotFoundError,
  UserNotFoundError,
  ValidationError,
} from './errors.js';

const STATUS_BY_ERROR = new Map<Function, number>([
  [ValidationError, 400],
  [SelfFollowError, 400],
  [UserNotFoundError, 404],
  [PostNotFoundError, 404],
  [TagNotFoundError, 404],
  [DuplicateFollowError, 409],
  [DuplicateEmailError, 409],
]);

// O `express.json()` rejeita corpo malformado ANTES de chegar ao controller e
// anexa o status HTTP no próprio erro (400 para JSON inválido, 413 para corpo
// grande demais). Sem tratar isso, tudo caía no 500 do default e o cliente
// recebia "erro interno" por um problema que era dele.
interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

function clientErrorStatus(err: Error): number | undefined {
  const { status, statusCode } = err as BodyParserError;
  const value = status ?? statusCode;
  // Só 4xx: um 5xx do body-parser continua sendo 500 nosso.
  return typeof value === 'number' && value >= 400 && value < 500 ? value : undefined;
}

// Os 4 parâmetros são obrigatórios: é assim que o Express reconhece uma
// função como error handler (em vez de um middleware comum).
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const knownStatus = STATUS_BY_ERROR.get(err.constructor);
  if (knownStatus !== undefined) {
    res.status(knownStatus).json({ error: err.message });
    return;
  }

  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== undefined) {
    const isParseFailure = (err as BodyParserError).type === 'entity.parse.failed';
    res.status(clientStatus).json({
      error: isParseFailure ? 'JSON inválido no corpo da requisição' : err.message,
    });
    return;
  }

  res.status(500).json({ error: err.message });
}

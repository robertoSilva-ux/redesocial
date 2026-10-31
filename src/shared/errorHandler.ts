import type { NextFunction, Request, Response } from 'express';
import { MAX_IMAGE_BYTES } from '../uploads/upload.js';
import {
  CommentNotFoundError,
  DuplicateEmailError,
  DuplicateFollowError,
  InvalidCredentialsError,
  PostNotFoundError,
  SelfFollowError,
  TagNotFoundError,
  UserNotFoundError,
  ValidationError,
} from './errors.js';

const STATUS_BY_ERROR = new Map<Function, number>([
  [ValidationError, 400],
  [SelfFollowError, 400],
  [InvalidCredentialsError, 401],
  [UserNotFoundError, 404],
  [PostNotFoundError, 404],
  [CommentNotFoundError, 404],
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

// ---------------------------------------------------------------------------
// Erros do Multer (upload). O multer 2 **não** anexa `status` ao erro: ele
// traz só `code` (LIMIT_FILE_SIZE, LIMIT_UNEXPECTED_FILE, ...). Sem este mapa,
// todo upload recusado caía no 500 genérico — arquivo grande respondia
// "Erro interno do servidor" em vez de 413 (achado do cartão E0c).
// ---------------------------------------------------------------------------
const MULTER_LIMIT_MB = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));

const MULTER_STATUS: Record<string, number> = {
  LIMIT_FILE_SIZE: 413,
  LIMIT_FILE_COUNT: 400,
  LIMIT_UNEXPECTED_FILE: 400,
  LIMIT_FIELD_KEY: 400,
  LIMIT_FIELD_VALUE: 400,
  LIMIT_FIELD_COUNT: 400,
  LIMIT_PART_COUNT: 400,
};

const MULTER_MESSAGE: Record<string, string> = {
  LIMIT_FILE_SIZE: `Arquivo maior que o limite de ${MULTER_LIMIT_MB} MB`,
  // O multer usa LIMIT_UNEXPECTED_FILE nos dois casos: campo com nome errado e
  // array passando do `maxCount` — por isso a mensagem cobre os dois.
  LIMIT_UNEXPECTED_FILE: 'Campo de arquivo não aceito ou limite de arquivos excedido nesta rota',
  LIMIT_FILE_COUNT: 'Arquivos demais para esta rota',
};

interface MulterErrorLike extends Error {
  code?: string;
  field?: string;
}

function multerFailure(err: Error): { status: number; message: string } | undefined {
  if (err.name !== 'MulterError') {
    return undefined;
  }
  const { code } = err as MulterErrorLike;
  return {
    status: (code ? MULTER_STATUS[code] : undefined) ?? 400,
    message: (code ? MULTER_MESSAGE[code] : undefined) ?? 'Requisição de upload inválida',
  };
}

// Os 4 parâmetros são obrigatórios: é assim que o Express reconhece uma
// função como error handler (em vez de um middleware comum).
//
// Este app mistura páginas (EJS, para navegador) e uma API JSON
// (/api/..., para o REST Client) — o mesmo erro de domínio (ex.: PostNotFoundError)
// precisa virar uma página de erro num caso e um JSON no outro.
//
// A decisão HTML × JSON olha DUAS coisas, nesta ordem:
//  1. o caminho: tudo sob `/api` responde JSON sempre. Antes, um cliente com
//     `Accept: */*` (curl, `fetch` sem header) recebia HTML de erro da API.
//  2. o header `Accept`, para as rotas HTML que também são chamadas por fetch.
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const knownStatus = STATUS_BY_ERROR.get(err.constructor);
  const uploadFailure = multerFailure(err);
  const status = uploadFailure?.status ?? knownStatus ?? clientErrorStatus(err) ?? 500;

  const isParseFailure = (err as BodyParserError).type === 'entity.parse.failed';

  // Erro interno NÃO expõe a mensagem: a mensagem de um erro desconhecido é
  // justamente onde vaza stack do Prisma, caminho do projeto e nome de tabela
  // (achado da revisão, cartão E0b). O detalhe vai para o log do servidor.
  if (status >= 500) {
    console.error('[erro interno]', err);
  }
  const message = isParseFailure
    ? 'JSON inválido no corpo da requisição'
    : (uploadFailure?.message ??
      (status >= 500 ? 'Erro interno do servidor' : err.message));

  const wantsHtml = !(req.path ?? '').startsWith('/api') && req.accepts(['html', 'json']) === 'html';

  if (wantsHtml) {
    res.status(status).render('error', { status, message });
    return;
  }
  res.status(status).json({ error: message });
}

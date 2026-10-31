import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { parseIdParam, sendError } from '../shared/http.js';

// AUTENTICAÇÃO ("quem é você?"): só verifica se existe uma sessão válida
// com um `userId`. Não olha PARA QUAL recurso a requisição é — só se há
// alguém logado. Toda rota que exige login passa por aqui primeiro.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.redirect('/login');
    return;
  }
  next();
}

// AUTORIZAÇÃO ("você pode fazer ISSO?"): roda DEPOIS de `requireAuth` (já
// sabemos quem é o usuário) e decide se ele pode agir sobre um recurso
// específico — aqui, se o post pertence a quem está logado. Autenticação
// e autorização são perguntas diferentes: um usuário autenticado pode
// ainda assim ser barrado por autorização (ex.: tentar apagar post de
// outra pessoa).
export function requireOwnPost(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Express 4 não captura rejeição de middleware async: sem este try/catch,
    // um id malformado viraria *unhandled rejection* em vez de 400.
    try {
      // Id malformado é erro do cliente (400), não 500 do Prisma — e a validação
      // fica aqui para valer em toda rota que passe por este middleware.
      const postId = parseIdParam(req.params.id);
      const post = await prisma.post.findUnique({ where: { id: postId } });

      if (!post) {
        sendError(req, res, 404, 'Post não encontrado');
        return;
      }
      if (post.authorId !== req.session.userId) {
        sendError(req, res, 403, 'Você não pode apagar um post de outra pessoa');
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * AUTORIZAÇÃO do comentário: quem apaga (ou edita) um comentário é quem o
 * escreveu — mesma pergunta de `requireOwnPost`, aplicada a outro recurso.
 *
 * Analogia com posts e justificativa da separação: `authorId` do comentário
 * vem da sessão quando ele é criado (nunca do corpo), e é isso que esta
 * checagem compara. Devolve JSON para `fetch` e página para formulário.
 */
export function requireOwnComment(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const commentId = parseIdParam(req.params.id);
      const comment = await prisma.comment.findUnique({ where: { id: commentId } });

      if (!comment) {
        sendError(req, res, 404, 'Comentário não encontrado');
        return;
      }
      if (comment.authorId !== req.session.userId) {
        sendError(req, res, 403, 'Você não pode apagar um comentário de outra pessoa');
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

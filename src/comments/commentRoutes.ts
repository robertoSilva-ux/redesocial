import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { CommentController } from './CommentController.js';
import { requireAuth, requireOwnComment } from '../auth/middleware.js';
import { asyncHandler, parseIdParam, wantsJson } from '../shared/http.js';

/**
 * Rotas de comentário — no módulo do recurso `Comment`, não dentro de
 * `webRoutes.ts` nem do `PostController` (ADR-0001). A colaboração com o post
 * acontece pelo `PrismaClient` compartilhado: este módulo verifica que o post
 * existe para dar 404 correto, mas não importa nada de `posts/`.
 *
 * Convenção de resposta, a mesma das curtidas (ADR-0004):
 *
 * - `POST` e `DELETE` servem os dois clientes. O formulário (sem JS) recebe
 *   redirect de volta para onde estava; o `fetch` do feed manda
 *   `Accept: application/json` e recebe o recurso criado / 204.
 * - `GET /posts/:id/comments` sempre responde JSON: não existe navegação de
 *   página para essa URL — a página do post renderiza os comentários no
 *   servidor. Um redirect aqui só confundiria um cliente de API.
 */
export function createCommentRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const comments = new CommentController(prisma);

  router.get(
    '/posts/:id/comments',
    asyncHandler(async (req, res) => {
      const page = await comments.listByPost(parseIdParam(req.params.id), req.query);
      res.json(page);
    }),
  );

  router.post(
    '/posts/:id/comments',
    requireAuth,
    asyncHandler(async (req, res) => {
      const postId = parseIdParam(req.params.id);
      // `req.session.userId` é a única fonte de autoria — o corpo não decide
      // quem comenta, mesmo que mande `authorId`.
      const comment = await comments.create(req.session.userId!, postId, req.body);

      if (wantsJson(req)) {
        res.status(201).json(comment);
        return;
      }
      // Sem JavaScript: volta para a página do post, onde o comentário aparece.
      res.redirect(`/posts/${postId}`);
    }),
  );

  router.delete(
    '/comments/:id',
    requireAuth,
    requireOwnComment(prisma),
    asyncHandler(async (req, res) => {
      await comments.remove(parseIdParam(req.params.id));

      if (wantsJson(req)) {
        res.status(204).end();
        return;
      }
      res.redirect(req.get('referer') ?? '/');
    }),
  );

  return router;
}

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { LikeController } from './LikeController.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, parseIdParam, wantsJson } from '../shared/http.js';

/**
 * Rotas de interação de curtida — num módulo do recurso `Like`, e não dentro
 * de `webRoutes.ts`/`PostController`, pela mesma razão registrada no README:
 * o like é um recurso próprio (pode apontar para post OU comentário), então
 * quem responde por ele não é o controller de Post.
 *
 * A MESMA rota serve os dois clientes: o formulário do feed (sem JS) recebe
 * um redirect de volta para onde o usuário estava; o `public/feed.js` manda
 * `Accept: application/json` e recebe o estado novo.
 */
export function createLikeRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const likeController = new LikeController(prisma);

  router.post(
    '/posts/:id/like',
    requireAuth,
    asyncHandler(async (req, res) => {
      const state = await likeController.togglePostLike(
        req.session.userId!,
        parseIdParam(req.params.id),
      );

      if (wantsJson(req)) {
        res.json(state);
        return;
      }
      // "voltar de onde veio": sem JS, o POST recarrega a página anterior.
      res.redirect(req.get('referer') ?? '/');
    }),
  );

  // Só o cliente JS usa DELETE (não existe formulário com esse verbo). Serve
  // para descurtir de forma idempotente, quando o cliente quer um sentido só.
  router.delete(
    '/posts/:id/like',
    requireAuth,
    asyncHandler(async (req, res) => {
      const state = await likeController.unlikePost(req.session.userId!, parseIdParam(req.params.id));
      res.json(state);
    }),
  );

  return router;
}

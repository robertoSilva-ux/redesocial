import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { CommentController } from './CommentController.js';
import { requireAuth, requireOwnComment } from '../auth/middleware.js';
import { asyncHandler, parseIdParam, wantsJson } from '../shared/http.js';
import ejs from 'ejs';
import path from 'node:path';

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
      const postId = parseIdParam(req.params.id);
      const viewerId = req.session.userId;

      // `viewerId` é opcional: sem sessão a listagem continua funcionando (API),
      // e `likedByMe` sai `false` — o mesmo critério do feed.
      const page = await comments.listByPost(postId, req.query, { viewerId });

      // Dois clientes para a MESMA leitura (espelho do ADR-0004/0010): o `fetch`
      // do toggle "mais curtidos" pede `Accept: text/html` e recebe o fragmento
      // com o partial do comentário; qualquer outro cliente recebe o JSON de
      // sempre. O partial é o único dono do markup — o cliente não remonta card.
      if (viewerId && !wantsJson(req) && req.accepts(['json', 'html']) === 'html') {
        const viewDir = path.join(import.meta.dirname, '..', 'views', 'partials');
        const html = page.data.length
          ? await Promise.all(
              page.data.map((comment) =>
                ejs.renderFile(path.join(viewDir, 'comment.ejs'), {
                  comment,
                  currentUser: { id: viewerId },
                }),
              ),
            )
          : ['<li class="text-sm text-slate-500">Nenhum comentário ainda.</li>'];

        res.setHeader('X-Total', String(page.meta.total));
        res.type('html').send(html.join('\n'));
        return;
      }

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

  // Editar o próprio comentário (atividade 7). PATCH é o verbo certo, e o
  // `fetch` do feed usa ele; o `<form>` do fallback usa POST /edit.
  router.patch(
    '/comments/:id',
    requireAuth,
    requireOwnComment(prisma),
    asyncHandler(async (req, res) => {
      const comment = await comments.update(parseIdParam(req.params.id), req.body);

      if (wantsJson(req)) {
        res.json(comment);
        return;
      }
      res.redirect(req.get('referer') ?? '/');
    }),
  );

  // Fallback sem JavaScript de edição: o formulário inline é interceptado pelo
  // feed.js; sem JS, ele manda POST aqui e a página recarrega com o texto novo.
  router.post(
    '/comments/:id/edit',
    requireAuth,
    requireOwnComment(prisma),
    asyncHandler(async (req, res) => {
      await comments.update(parseIdParam(req.params.id), req.body);
      res.redirect(req.get('referer') ?? '/');
    }),
  );

  // Fallback sem JavaScript: `<form>` só sabe POST, e o ADR-0004 exige que a
  // ação funcione sem JS. Mesma autorização, mesmo efeito — a diferença é só
  // o verbo e o formato da resposta (sempre redirect).
  router.post(
    '/comments/:id/delete',
    requireAuth,
    requireOwnComment(prisma),
    asyncHandler(async (req, res) => {
      await comments.remove(parseIdParam(req.params.id));
      res.redirect(req.get('referer') ?? '/');
    }),
  );

  return router;
}

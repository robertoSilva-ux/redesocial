import { Router } from 'express';
import type { UserController } from './users/UserController.js';
import type { PostController } from './posts/PostController.js';
import type { CommentController } from './comments/CommentController.js';
import type { LikeController } from './likes/LikeController.js';
import type { UserProfileController } from './profiles/UserProfileController.js';
import type { ImageController } from './images/ImageController.js';
import { asyncHandler, parseIdParam } from './shared/http.js';

// API JSON só de LEITURA (montada em /api pelo server.ts). Escritas
// (criar usuário, seguir, criar post) migraram para src/webRoutes.ts,
// porque agora dependem de quem está logado (sessão) — ver Aula05/aula05.md.
export interface ApiControllers {
  user: UserController;
  post: PostController;
  comment: CommentController;
  like: LikeController;
  profile: UserProfileController;
  image: ImageController;
}

export function createRoutes(controllers: ApiControllers): Router {
  const router = Router();
  const { user, post, comment, like, profile, image } = controllers;

  // ------------------------------------------------- leitura de um recurso

  router.get(
    '/users/:id',
    asyncHandler(async (req, res) => {
      // `parseIdParam` troca `NaN` por 400: sem isso, `/api/users/abc`
      // chegava ao Prisma e virava 500 com stack no corpo.
      const found = await user.get(parseIdParam(req.params.id));
      res.json(found);
    }),
  );

  router.get(
    '/users/:id/feed',
    asyncHandler(async (req, res) => {
      const feed = await user.feed(parseIdParam(req.params.id));
      res.json(feed);
    }),
  );

  router.get(
    '/posts/:id',
    asyncHandler(async (req, res) => {
      const found = await post.get(parseIdParam(req.params.id));
      res.json(found);
    }),
  );

  router.get(
    '/tags/:name/posts',
    asyncHandler(async (req, res) => {
      const posts = await post.listByTag(req.params.name);
      res.json(posts);
    }),
  );

  // ---------------------------------- listagens paginadas (Exercício 2)
  // Envelope comum: { data: [...], meta: { page, pageSize, total,
  // totalPages, hasNext, sort, order } } — ver src/shared/pagination.ts.
  // ATENÇÃO à ordem: `/posts` precisa vir depois de `/posts/:id`? Não —
  // Express casa rota exata antes de parâmetro, mas manter /posts antes
  // evita surpresa se alguém trocar por um curinga.

  router.get(
    '/posts',
    asyncHandler(async (req, res) => {
      res.json(await post.list(req.query));
    }),
  );

  router.get(
    '/comments',
    asyncHandler(async (req, res) => {
      res.json(await comment.list(req.query));
    }),
  );

  router.get(
    '/likes',
    asyncHandler(async (req, res) => {
      res.json(await like.list(req.query));
    }),
  );

  router.get(
    '/profiles',
    asyncHandler(async (req, res) => {
      res.json(await profile.list(req.query));
    }),
  );

  router.get(
    '/images',
    asyncHandler(async (req, res) => {
      res.json(await image.list(req.query));
    }),
  );

  return router;
}

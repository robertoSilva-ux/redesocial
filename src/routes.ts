import { Router } from 'express';
import type { UserController } from './users/UserController.js';
import type { PostController } from './posts/PostController.js';
import type { CommentController } from './comments/CommentController.js';
import type { LikeController } from './likes/LikeController.js';
import type { UserProfileController } from './profiles/UserProfileController.js';
import type { ImageController } from './images/ImageController.js';
import { asyncHandler } from './shared/http.js';

export interface Controllers {
  user: UserController;
  post: PostController;
  comment: CommentController;
  like: LikeController;
  profile: UserProfileController;
  image: ImageController;
}

export function createRoutes(controllers: Controllers): Router {
  const router = Router();
  const { user, post, comment, like, profile, image } = controllers;

  // ---------------------------------------------------------------- escrita

  router.post(
    '/users',
    asyncHandler(async (req, res) => {
      const created = await user.create(req.body);
      res.status(201).json(created);
    }),
  );

  router.post(
    '/users/:id/follow',
    asyncHandler(async (req, res) => {
      await user.follow(Number(req.params.id), req.body);
      res.status(204).send();
    }),
  );

  router.post(
    '/posts',
    asyncHandler(async (req, res) => {
      const created = await post.create(req.body);
      res.status(201).json(created);
    }),
  );

  // --------------------------------------------------------------- leitura 1

  router.get(
    '/users/:id',
    asyncHandler(async (req, res) => {
      res.json(await user.get(Number(req.params.id)));
    }),
  );

  router.get(
    '/posts/:id',
    asyncHandler(async (req, res) => {
      res.json(await post.get(Number(req.params.id)));
    }),
  );

  // ------------------------------------------------------------- listagens
  // Todas devolvem o mesmo envelope:
  //   { data: [...], meta: { page, pageSize, total, totalPages, hasNext, sort, order } }
  // e aceitam ?page=&pageSize=&sort=&order= (ver src/shared/pagination.ts).
  // ATENÇÃO à ordem: `/posts` precisa vir antes de `/posts/:id` para não ser
  // capturado como id.

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

  router.get(
    '/users/:id/feed',
    asyncHandler(async (req, res) => {
      res.json(await user.feed(Number(req.params.id), req.query));
    }),
  );

  router.get(
    '/tags/:name/posts',
    asyncHandler(async (req, res) => {
      res.json(await post.listByTag(req.params.name, req.query));
    }),
  );

  return router;
}

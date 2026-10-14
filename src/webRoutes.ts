import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AuthController } from './auth/AuthController.js';
import { UserController } from './users/UserController.js';
import { PostController } from './posts/PostController.js';
import { requireAuth, requireOwnPost } from './auth/middleware.js';
import { upload } from './uploads/upload.js';
import type { ImageStorage } from './uploads/storage.js';
import { asyncHandler } from './shared/http.js';
import { DuplicateEmailError, InvalidCredentialsError, ValidationError } from './shared/errors.js';

// Rotas que servem HTML (EJS) e dependem de sessão — diferente de
// routes.ts, que é só a API JSON de leitura. `requireAuth` (autenticação)
// e `requireOwnPost` (autorização) ficam em src/auth/middleware.ts.
export function createWebRoutes(prisma: PrismaClient, imageStorage: ImageStorage): Router {
  const router = Router();
  const authController = new AuthController(prisma);
  const userController = new UserController(prisma);
  const postController = new PostController(prisma);

  router.get('/register', (req, res) => {
    res.render('register', { error: null });
  });

  router.post(
    '/register',
    upload.single('avatar'),
    asyncHandler(async (req, res) => {
      try {
        let avatarUrl: string | undefined;
        if (req.file) {
          avatarUrl = await imageStorage.upload(req.file);
        }
        const user = await authController.register(req.body, avatarUrl);
        req.session.userId = user.id;
        res.redirect('/');
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).render('register', { error: err.message });
          return;
        }
        if (err instanceof DuplicateEmailError) {
          res.status(409).render('register', { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.get('/login', (req, res) => {
    res.render('login', { error: null });
  });

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      try {
        const user = await authController.login(req.body);
        // É isso que "loga" o usuário: guardar o id na sessão. A partir
        // daqui, toda requisição desse navegador vai carregar
        // `req.session.userId` (via cookie) até o logout ou o cookie expirar.
        req.session.userId = user.id; 
        // req.session.user = user; // Ensure the `user` type matches the extended session type
        res.redirect('/');
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          res.status(401).render('login', { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });

  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserId = req.session.userId!;
      const [currentUser, feed, others] = await Promise.all([
        userController.get(currentUserId),
        userController.feed(currentUserId),
        userController.listOthers(currentUserId),
      ]);
      res.render('feed', { currentUser, feed, others });
    }),
  );

  router.get('/posts/new', requireAuth, (req, res) => {
    res.render('newPost', { error: null });
  });

  router.post(
    '/posts',
    requireAuth, // middlware
    upload.single('image'), // middleware
    asyncHandler(async (req, res) => {
      try {
        let imageUrl: string | undefined;
        // o parse do arquivo fica disponivel em req.file
        if (req.file) {
          console.log({ file: req.file })
          imageUrl = await imageStorage.upload(req.file);
        }
        const tags = typeof req.body.tags === 'string'
          ? req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : undefined;

        await postController.create(req.session.userId!, { content: req.body.content, tags }, imageUrl);
        res.redirect('/');
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).render('newPost', { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    '/posts/:id/delete',
    requireAuth,
    requireOwnPost(prisma),
    asyncHandler(async (req, res) => {
      await postController.remove(Number(req.params.id));
      res.redirect('/');
    }),
  );

  router.post(
    '/follow',
    requireAuth,
    asyncHandler(async (req, res) => {
      await userController.follow(req.session.userId!, { targetId: Number(req.body.targetId) });
      res.redirect('/');
    }),
  );

  return router;
}

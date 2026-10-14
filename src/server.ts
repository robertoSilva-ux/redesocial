import path from 'node:path';
import express, { type Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { UserController } from './users/UserController.js';
import { PostController } from './posts/PostController.js';
import { CommentController } from './comments/CommentController.js';
import { LikeController } from './likes/LikeController.js';
import { UserProfileController } from './profiles/UserProfileController.js';
import { ImageController } from './images/ImageController.js';
import { createRoutes } from './routes.js';
import { createWebRoutes } from './webRoutes.js';
import { createLikeRoutes } from './likes/likeRoutes.js';
import { createSessionMiddleware } from './auth/session.js';
import { createImageStorage } from './uploads/createImageStorage.js';
import { UPLOAD_DIR } from './uploads/localStorage.js';
import type { ImageStorage } from './uploads/storage.js';
import { errorHandler } from './shared/errorHandler.js';

export function createServer(prisma: PrismaClient, imageStorage: ImageStorage = createImageStorage()): Express {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(import.meta.dirname, 'views'));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // formulários EJS enviam application/x-www-form-urlencoded
  app.use(createSessionMiddleware());

  // Arquivos estáticos do cliente (o JS de curtir/comentar/carrossel/scroll
  // infinito do feed — ver public/). O HTML carrega com `defer`, e a
  // delegação de eventos cuida dos nós que ainda não existem.
  app.use(express.static(path.join(import.meta.dirname, '..', 'public')));

  // Serve os arquivos gravados por `LocalImageStorage` (dev/aula sem AWS).
  // Com S3ImageStorage em uso, esta rota simplesmente não é acessada.
  app.use('/uploads', express.static(UPLOAD_DIR));

  const userController = new UserController(prisma);
  const postController = new PostController(prisma);

  // Interações (curtir/descurtir) ficam no módulo do recurso `Like`, não em
  // webRoutes.ts — ver src/likes/likeRoutes.ts e a justificativa no README.
  app.use(createLikeRoutes(prisma));

  app.use(createWebRoutes(prisma, imageStorage));
  app.use(
    '/api',
    createRoutes({
      user: userController,
      post: postController,
      comment: new CommentController(prisma),
      like: new LikeController(prisma),
      profile: new UserProfileController(prisma),
      image: new ImageController(prisma),
    }),
  );

  app.use(errorHandler);

  return app;
}

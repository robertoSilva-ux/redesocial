import express, { type Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { UserController } from './users/UserController.js';
import { PostController } from './posts/PostController.js';
import { CommentController } from './comments/CommentController.js';
import { LikeController } from './likes/LikeController.js';
import { UserProfileController } from './profiles/UserProfileController.js';
import { ImageController } from './images/ImageController.js';
import { createRoutes } from './routes.js';
import { errorHandler } from './shared/errorHandler.js';

export function createServer(prisma: PrismaClient): Express {
  const app = express();
  app.use(express.json());

  app.use(
    createRoutes({
      user: new UserController(prisma),
      post: new PostController(prisma),
      comment: new CommentController(prisma),
      like: new LikeController(prisma),
      profile: new UserProfileController(prisma),
      image: new ImageController(prisma),
    }),
  );

  app.use(errorHandler);

  return app;
}

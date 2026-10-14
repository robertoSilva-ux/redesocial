import express, { type Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { UserController } from './users/UserController.js';
import { PostController } from './posts/PostController.js';
import { createRoutes } from './routes.js';
import { errorHandler } from './shared/errorHandler.js';

export function createServer(prisma: PrismaClient): Express {
  const app = express();
  app.use(express.json());

  const userController = new UserController(prisma);
  const postController = new PostController(prisma);
  app.use(createRoutes(userController, postController));

  app.use(errorHandler);

  return app;
}

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AuthController } from './auth/AuthController.js';
import { UserController } from './users/UserController.js';
import { PostController } from './posts/PostController.js';
import { requireAuth, requireOwnPost } from './auth/middleware.js';
import { MAX_POST_IMAGES, upload } from './uploads/upload.js';
import type { ImageStorage } from './uploads/storage.js';
import { asyncHandler, parseIdParam } from './shared/http.js';
import { decodeFeedCursor } from './shared/pagination.js';
import { CommentController } from './comments/CommentController.js';
import ejs from 'ejs';
import path from 'node:path';
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
      const [currentUser, pagina, others] = await Promise.all([
        userController.get(currentUserId),
        userController.feedPage(currentUserId),
        userController.listOthers(currentUserId),
      ]);
      // A primeira página já informa o cursor: é o que o scroll infinito usa
      // para continuar de onde a renderização inicial parou (ADR-0010).
      res.render('feed', { currentUser, feed: pagina.posts, others, nextCursor: pagina.nextCursor });
    }),
  );

  /**
   * Próximo lote do feed — FRAGMENTO HTML, não JSON (ADR-0010).
   *
   * Responde o mesmo markup de `partials/postCard.ejs` que o `GET /` renderiza,
   * e devolve o cursor do lote seguinte no header `X-Next-Cursor`
   * (ausente = fim da lista). O cliente insere com `insertAdjacentHTML` e a
   * delegação de eventos do `feed.js` já cobre os cards novos.
   */
  router.get(
    '/feed/more',
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserId = req.session.userId!;
      const cursor = decodeFeedCursor(req.query.cursor);
      const limite = Number(req.query.limit ?? 10);
      const limit = Number.isFinite(limite) ? limite : 10;

      const [pagina, currentUser] = await Promise.all([
        userController.feedPage(currentUserId, { cursor, limit }),
        userController.get(currentUserId),
      ]);

      const html = await Promise.all(
        pagina.posts.map((post) =>
          ejs.renderFile(path.join(import.meta.dirname, 'views', 'partials', 'postCard.ejs'), {
            post,
            currentUser,
          }),
        ),
      );

      if (pagina.nextCursor) {
        res.setHeader('X-Next-Cursor', pagina.nextCursor);
      }
      res.type('html').send(html.join('\n'));
    }),
  );

  router.get('/posts/new', requireAuth, (req, res) => {
    res.render('newPost', { error: null });
  });

  // Página do post. Fica DEPOIS de `/posts/new` de propósito: `new` casaria
  // com `:id` e viraria 400 (id não numérico) em vez de abrir o formulário.
  router.get(
    '/posts/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentUserId = req.session.userId!;
      const postId = parseIdParam(req.params.id);

      // Os comentários vêm do módulo `comments/`, não do `include` do post: é
      // ele quem entende ordenação (ADR-0005), paginação e `likedByMe`. A
      // composição acontece aqui, na borda — `posts/` não importa `comments/`.
      const [currentUser, post, comentarios] = await Promise.all([
        userController.get(currentUserId),
        postController.getForView(postId, currentUserId),
        new CommentController(prisma).listByPost(postId, req.query, { viewerId: currentUserId }),
      ]);

      // Sem JS, os links de ordenação recarregam a página com `?sort=`; com JS,
      // o `commentSort.js` busca o fragmento e troca a lista (ADR-0004/0010).
      res.render('post', {
        currentUser,
        post,
        comments: comentarios.data,
        commentSort: comentarios.meta.sort,
        commentTotal: comentarios.meta.total,
        error: null,
      });
    }),
  );

  router.post(
    '/posts',
    requireAuth, // middlware
    // Até 5 fotos por post. Cada arquivo passa pela MESMA `ImageStorage`
    // (ADR-0007): `array` só muda quantos buffers chegam de uma vez.
    upload.array('images', MAX_POST_IMAGES),
    asyncHandler(async (req, res) => {
      try {
        // O parse dos arquivos fica em `req.files`. O binário vai direto do
        // buffer para o `ImageStorage`, um `upload()` por arquivo — e é a
        // ordem desse laço que define `PostImage.order`.
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        const imageUrls: string[] = [];
        for (const file of files) {
          imageUrls.push(await imageStorage.upload(file));
        }

        const tags = typeof req.body.tags === 'string'
          ? req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : undefined;

        await postController.create(req.session.userId!, { content: req.body.content, tags }, imageUrls);
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

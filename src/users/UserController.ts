import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DuplicateFollowError, SelfFollowError, UserNotFoundError, ValidationError } from '../shared/errors.js';
import { publicUserSelect } from '../shared/selects.js';
import { encodeFeedCursor, type FeedCursor } from '../shared/pagination.js';

// Criar usuário agora é responsabilidade só do AuthController#register
// (precisa de senha/hash) — não existe mais um "criar usuário sem senha"
// aqui, de propósito.
//
// Sobre `select`: todo retorno que pode virar resposta HTTP usa
// `publicUserSelect` (src/shared/selects.ts). Nenhum método aqui devolve a
// linha crua de `User`, porque ela carrega `passwordHash`.
// Quantos posts por lote do feed (primeira página e cada `fetch` do scroll).
export const FEED_PAGE_SIZE = 10;

export class UserController {
  constructor(private readonly prisma: PrismaClient) {}

  async get(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...publicUserSelect,
        _count: { select: { posts: true, followers: true, following: true } },
      },
    });
    if (!user) {
      throw new UserNotFoundError(id);
    }
    return user;
  }

  // Autorrelação N:N em ação: um User segue outro User através da tabela
  // de junção explícita `Follow`.
  async follow(followerId: number, body: unknown) {
    const { targetId } = (body ?? {}) as { targetId?: unknown };
    if (typeof targetId !== 'number' || !Number.isInteger(targetId)) {
      throw new ValidationError('"targetId" é obrigatório e deve ser um número inteiro');
    }
    if (targetId === followerId) {
      throw new SelfFollowError();
    }

    const [follower, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: followerId } }),
      this.prisma.user.findUnique({ where: { id: targetId } }),
    ]);
    if (!follower) {
      throw new UserNotFoundError(followerId);
    }
    if (!target) {
      throw new UserNotFoundError(targetId);
    }

    try {
      return await this.prisma.follow.create({
        data: { followerId, followingId: targetId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DuplicateFollowError();
      }
      throw err;
    }
  }

  // Feed = posts de quem eu sigo. Mostra um filtro relacional aninhado:
  // "posts cujo autor tem, entre seus seguidores, um Follow onde eu sou o
  // follower" — sem precisar buscar a lista de ids manualmente antes.
  //
  // A view do feed lê, por post: `_count.likes`, `_count.comments` e
  // `likedByMe`; e, por comentário listado, `_count.likes` e `likedByMe`. As
  // curtidas saem em DUAS consultas por página (uma para posts, outra para os
  // comentários da página) — não um `findUnique` por item (N+1).
  //
  // `feedPage` é o único lugar que monta essa consulta: a primeira página
  // (`GET /`) e o fragmento do scroll infinito (`GET /feed/more`) chamam este
  // método e só diferem no cursor. Se fossem duas consultas, elas divergiriam
  // (ADR-0010).
  async feedPage(userId: number, options: { cursor?: FeedCursor; limit?: number } = {}) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const limit = Math.min(Math.max(options.limit ?? FEED_PAGE_SIZE, 1), 50);
    const { cursor } = options;

    const where: Prisma.PostWhereInput = {
      author: { followers: { some: { followerId: userId } } },
      // Cursor composto: "posts mais antigos que o último lido", com `id` como
      // desempate quando o `createdAt` empata na resolução de segundo.
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.post.findMany({
      where,
      include: {
        author: { select: publicUserSelect },
        tags: true,
        images: { orderBy: { order: 'asc' } },
        _count: { select: { likes: true, comments: true } },
        // Os 3 primeiros comentários de cada post (`take` em relação aninhada
        // vale por post). Ordem cronológica para o comentário novo, inserido
        // pelo JS, entrar no fim sem reordenar a lista.
        comments: {
          take: 3,
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: publicUserSelect },
            _count: { select: { likes: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Um a mais que o limite: a existência do excedente é o que diz se há
      // próxima página, sem precisar de um `count()` separado.
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;
    const last = posts[posts.length - 1];
    const nextCursor = hasMore && last ? encodeFeedCursor(last) : null;

    const myLikes = await this.prisma.like.findMany({
      where: { userId, postId: { in: posts.map((post) => post.id) } },
      select: { postId: true },
    });
    const likedPostIds = new Set(myLikes.map((like) => like.postId));

    const commentIds = posts.flatMap((post) => post.comments.map((comment) => comment.id));
    const myCommentLikes = commentIds.length
      ? await this.prisma.like.findMany({
          where: { userId, commentId: { in: commentIds } },
          select: { commentId: true },
        })
      : [];
    const likedCommentIds = new Set(myCommentLikes.map((like) => like.commentId));

    return {
      posts: posts.map((post) => ({
        ...post,
        likedByMe: likedPostIds.has(post.id),
        comments: post.comments.map((comment) => ({
          ...comment,
          likedByMe: likedCommentIds.has(comment.id),
        })),
      })),
      nextCursor,
    };
  }

  // Primeira página do feed — usada pela view e pela API de leitura
  // (`/api/users/:id/feed`), que continua devolvendo só a lista.
  async feed(userId: number) {
    const { posts } = await this.feedPage(userId);
    return posts;
  }

  // Lista para a tela inicial sugerir quem seguir: todo mundo, exceto eu
  // mesmo, marcando quem eu já sigo (`isFollowing`) para a view decidir
  // entre mostrar o botão "Seguir" ou "Já segue".
  async listOthers(currentUserId: number) {
    const users = await this.prisma.user.findMany({
      where: { id: { not: currentUserId } },
      select: publicUserSelect,
      orderBy: { name: 'asc' },
    });
    const following = await this.prisma.follow.findMany({ where: { followerId: currentUserId } });
    const followingIds = new Set(following.map((f) => f.followingId));

    return users.map((user) => ({ ...user, isFollowing: followingIds.has(user.id) }));
  }
}

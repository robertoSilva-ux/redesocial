import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DuplicateFollowError, SelfFollowError, UserNotFoundError, ValidationError } from '../shared/errors.js';
import { publicUserSelect } from '../shared/selects.js';

// Criar usuário agora é responsabilidade só do AuthController#register
// (precisa de senha/hash) — não existe mais um "criar usuário sem senha"
// aqui, de propósito.
//
// Sobre `select`: todo retorno que pode virar resposta HTTP usa
// `publicUserSelect` (src/shared/selects.ts). Nenhum método aqui devolve a
// linha crua de `User`, porque ela carrega `passwordHash`.
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
  // `likedByMe` (ver src/views/feed.ejs). `likedByMe` sai de UMA consulta
  // para todos os posts da página — o mesmo truque que `listOthers` usa
  // para `isFollowing`, e não um `findUnique` por post (N+1).
  async feed(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const posts = await this.prisma.post.findMany({
      where: { author: { followers: { some: { followerId: userId } } } },
      include: {
        author: { select: publicUserSelect },
        tags: true,
        images: true,
        _count: { select: { likes: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const myLikes = await this.prisma.like.findMany({
      where: { userId, postId: { in: posts.map((post) => post.id) } },
      select: { postId: true },
    });
    const likedPostIds = new Set(myLikes.map((like) => like.postId));

    return posts.map((post) => ({ ...post, likedByMe: likedPostIds.has(post.id) }));
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

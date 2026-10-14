import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  DuplicateEmailError,
  DuplicateFollowError,
  SelfFollowError,
  UserNotFoundError,
  ValidationError,
} from '../shared/errors.js';

export class UserController {
  constructor(private readonly prisma: PrismaClient) {}

  async create(body: unknown) {
    const { name, email } = (body ?? {}) as { name?: unknown; email?: unknown };
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('"name" é obrigatório');
    }
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new ValidationError('"email" é obrigatório');
    }

    try {
      return await this.prisma.user.create({ data: { name, email } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DuplicateEmailError(email);
      }
      throw err;
    }
  }

  async get(id: number) {
    // FIND UNIQUE DO PRISMA
    const user = await this.prisma.user.findUnique({
      where: { id },  // busca pelo id do usuário

      // ALMA DO ORM
      // permite buscar dados relacionados (posts, seguidores, seguindo) em uma única query
      include: {
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
  async feed(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    return this.prisma.post.findMany({
      // O FOLLOWER ID DE ALGUNS DOS SEGUIDORES DO AUTOR DO POST É O ID DO USUÁRIO LOGADO
      // FEED SÃO OS POSTS DE TODOS QUE ESTOU SEGUINDO
      // BUSCA AUTORES QUE ESTOU SEGUINDO
      where: { author: { followers: { some: { followerId: userId } } } },
      include: { author: true, tags: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}

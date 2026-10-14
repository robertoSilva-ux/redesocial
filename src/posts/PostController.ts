import type { PrismaClient } from '@prisma/client';
import { PostNotFoundError, TagNotFoundError, UserNotFoundError, ValidationError } from '../shared/errors.js';
import { buildOrderBy, buildPage, parsePagination, SORTABLE_FIELDS } from '../shared/pagination.js';

export class PostController {
  constructor(private readonly prisma: PrismaClient) {}

  // 1:N (author) + N:N (tags) na mesma escrita: `connect` liga o post a um
  // autor existente, `connectOrCreate` reaproveita tags já cadastradas ou
  // cria as que ainda não existem — tudo em uma única operação do Prisma.
  async create(body: unknown) {
    const { authorId, content, tags } = (body ?? {}) as {
      authorId?: unknown;
      content?: unknown;
      tags?: unknown;
    };

    if (typeof authorId !== 'number' || !Number.isInteger(authorId)) {
      throw new ValidationError('"authorId" é obrigatório e deve ser um número inteiro');
    }
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new ValidationError('"content" é obrigatório');
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string'))) {
      throw new ValidationError('"tags", quando informado, deve ser uma lista de strings');
    }

    const author = await this.prisma.user.findUnique({ where: { id: authorId } });
    if (!author) {
      throw new UserNotFoundError(authorId);
    }

    const tagNames = (tags as string[] | undefined) ?? [];

    return this.prisma.post.create({
      data: {
        content,
        author: { connect: { id: authorId } },
        tags: {
          connectOrCreate: tagNames.map((name) => ({
            where: { name },
            create: { name },
          })),
        },
      },
      include: { author: true, tags: true },
    });
  }

  async get(id: number) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      // inclui dados do author e das tags
      include: { author: {
        select: { name: true, avatarUrl: true }
        // omit: {email: true, createdAt: true}
      }, tags: true },
    });
    if (!post) {
      throw new PostNotFoundError(id);
    }
    return post;
  }

  // Listagem global paginada: GET /posts?page=&pageSize=&sort=&order=
  async list(query: unknown) {
    const page = parsePagination(query, { sortable: SORTABLE_FIELDS.post });

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
          _count: { select: { comments: true, likes: true } },
        },
        orderBy: buildOrderBy(page),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.post.count(),
    ]);

    return buildPage(posts, total, page);
  }

  async listByTag(name: string, query: unknown) {
    const page = parsePagination(query, { sortable: SORTABLE_FIELDS.post });

    const tag = await this.prisma.tag.findUnique({ where: { name } });
    if (!tag) {
      throw new TagNotFoundError(name);
    }

    // Filtra pela relação em vez de carregar `tag.posts` inteiro: assim o
    // skip/take acontecem no banco (LIMIT/OFFSET), não na memória.
    const where = { tags: { some: { name } } };

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        // include de multilpos niveis
        include: { author: true, tags: true },
        orderBy: buildOrderBy(page),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.post.count({ where }),
    ]);

    return buildPage(posts, total, page);
  }
}

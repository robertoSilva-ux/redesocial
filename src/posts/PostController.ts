import type { PrismaClient } from '@prisma/client';
import { PostNotFoundError, TagNotFoundError, UserNotFoundError, ValidationError } from '../shared/errors.js';
import { buildOrderBy, buildPage, parsePagination, SORTABLE_FIELDS } from '../shared/pagination.js';

export class PostController {
  constructor(private readonly prisma: PrismaClient) {}

  // `authorId` vem da SESSÃO (ver src/webRoutes.ts), nunca do corpo da
  // requisição: é a autorização "você só pode postar como você mesmo" em
  // código — antes da Aula 05 (sem login), qualquer chamador podia mandar
  // qualquer `authorId` no body.
  //
  // 1:N (author) + N:N (tags) na mesma escrita: `connect` liga o post a um
  // autor existente, `connectOrCreate` reaproveita tags já cadastradas ou
  // cria as que ainda não existem — tudo em uma única operação do Prisma.
  async create(authorId: number, body: unknown, imageUrl?: string) {
    const { content, tags } = (body ?? {}) as { content?: unknown; tags?: unknown };

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
        imageUrl,
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
      include: { author: true, tags: true },
    });
    if (!post) {
      throw new PostNotFoundError(id);
    }
    return post;
  }

  async listByTag(name: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { name },
      include: { posts: { include: { author: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (!tag) {
      throw new TagNotFoundError(name);
    }
    return tag.posts;
  }

  // Listagem global paginada e ordenável (Exercício 2 da Aula 04, mantida
  // na API JSON): GET /api/posts?page=&pageSize=&sort=&order=
  async list(query: unknown) {
    const page = parsePagination(query, { sortable: SORTABLE_FIELDS.post });

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
          images: true,
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

  // A checagem "é dono do post?" já aconteceu no middleware
  // `requireOwnPost` (src/auth/middleware.ts) antes desta rota ser
  // chamada — aqui só falta apagar.
  async remove(id: number): Promise<void> {
    await this.prisma.post.delete({ where: { id } });
  }
}

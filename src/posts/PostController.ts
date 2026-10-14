import type { PrismaClient } from '@prisma/client';
import { PostNotFoundError, TagNotFoundError, UserNotFoundError, ValidationError } from '../shared/errors.js';

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

  async listByTag(name: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { name },
      // include de multilpos niveis
      include: { posts: { include: { author: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (!tag) {
      throw new TagNotFoundError(name);
    }
    return tag.posts;
  }
}

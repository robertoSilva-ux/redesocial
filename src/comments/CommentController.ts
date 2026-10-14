import type { PrismaClient } from '@prisma/client';
import { buildOrderBy, buildPage, parsePagination, SORTABLE_FIELDS } from '../shared/pagination.js';

export class CommentController {
  constructor(private readonly prisma: PrismaClient) {}

  // GET /comments?page=1&pageSize=10&sort=createdAt&order=desc
  async list(query: unknown) {
    const page = parsePagination(query, { sortable: SORTABLE_FIELDS.comment });

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { replies: true, likes: true } },
        },
        orderBy: buildOrderBy(page),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.comment.count(),
    ]);

    return buildPage(comments, total, page);
  }
}

import type { PrismaClient } from '@prisma/client';
import { buildOrderBy, buildPage, parsePagination, SORTABLE_FIELDS } from '../shared/pagination.js';

export class LikeController {
  constructor(private readonly prisma: PrismaClient) {}

  // GET /likes?page=1&pageSize=10&sort=createdAt&order=desc
  async list(query: unknown) {
    const page = parsePagination(query, { sortable: SORTABLE_FIELDS.like });

    const [likes, total] = await Promise.all([
      this.prisma.like.findMany({
        include: {
          user: { select: { id: true, name: true } },
          post: { select: { id: true, content: true } },
          comment: { select: { id: true, content: true } },
        },
        orderBy: buildOrderBy(page),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.like.count(),
    ]);

    return buildPage(likes, total, page);
  }
}

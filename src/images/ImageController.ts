import type { PrismaClient } from '@prisma/client';
import { buildOrderBy, buildPage, parsePagination, SORTABLE_FIELDS } from '../shared/pagination.js';

export class ImageController {
  constructor(private readonly prisma: PrismaClient) {}

  // GET /images?page=1&pageSize=10&sort=createdAt&order=desc
  async list(query: unknown) {
    const page = parsePagination(query, { sortable: SORTABLE_FIELDS.image });

    const [images, total] = await Promise.all([
      this.prisma.image.findMany({
        include: {
          owner: { select: { id: true, name: true } },
          post: { select: { id: true, content: true } },
        },
        orderBy: buildOrderBy(page),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.image.count(),
    ]);

    return buildPage(images, total, page);
  }
}

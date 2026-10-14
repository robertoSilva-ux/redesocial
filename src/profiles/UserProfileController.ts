import type { PrismaClient } from '@prisma/client';
import { buildOrderBy, buildPage, parsePagination, SORTABLE_FIELDS } from '../shared/pagination.js';

export class UserProfileController {
  constructor(private readonly prisma: PrismaClient) {}

  // GET /profiles?page=1&pageSize=10&sort=displayName&order=asc
  // (lista branca de sort: createdAt, id, displayName)
  async list(query: unknown) {
    const page = parsePagination(query, { sortable: SORTABLE_FIELDS.profile });

    const [profiles, total] = await Promise.all([
      this.prisma.userProfile.findMany({
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: buildOrderBy(page),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.userProfile.count(),
    ]);

    return buildPage(profiles, total, page);
  }
}

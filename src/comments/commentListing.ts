import type { Prisma } from '@prisma/client';
import {
  buildOrderBy,
  parsePagination,
  SORTABLE_FIELDS,
  type PageRequest,
  type SortOrder,
} from '../shared/pagination.js';

/**
 * `?sort=likes` — mais curtidos primeiro (item 9 do Trabalho II).
 *
 * É uma ordenação POR RELAÇÃO: o critério é a contagem de `Comment.likes`, e o
 * `buildOrderBy` de `shared/pagination.ts` monta `orderBy` a partir de UMA
 * coluna. A ADR-0005 já registrava esse limite e a mitigação: a ordenação por
 * contagem vira consulta própria do módulo `comments/`, e o helper
 * compartilhado não é estendido. Por isso `orderBy` é montado aqui.
 *
 * O caminho ingênuo — acrescentar `'likes'` a `SORTABLE_FIELDS.comment` — não
 * serve: o helper produziria `{ likes: 'desc' }`, que o Prisma recusa com
 * `PrismaClientValidationError` (ele espera o agregado da relação), e esse erro
 * não está mapeado no `errorHandler` → 500 em vez de 400. Então `likes` é
 * lido da query ANTES do `parsePagination` e devolvido no `meta` depois; a
 * lista branca continua só com colunas de verdade.
 *
 * Desempate: `createdAt` no SQLite tem resolução de SEGUNDO, então comentários
 * criados no mesmo segundo empatam na contagem e na data. `id desc` fecha a
 * ordenação, o que mantém a página 2 sem repetir (nem pular) item da página 1.
 */
export const LIKES_SORT = 'likes';

const ORDER_BY_LIKES: Prisma.CommentOrderByWithRelationInput[] = [
  { likes: { _count: 'desc' } },
  { createdAt: 'desc' },
  { id: 'desc' },
];

export interface CommentListing {
  /** Contrato de paginação (skip/take + o que vai no `meta`). */
  page: PageRequest;
  /** `orderBy` já resolvido: do helper compartilhado ou o de curtidas. */
  orderBy: Prisma.CommentOrderByWithRelationInput[];
}

interface ListingOptions {
  defaultOrder?: SortOrder;
}

function isLikesSort(query: unknown): boolean {
  // Query repetida (`?sort=likes&sort=likes`) chega como array e NÃO casa: cai
  // no `parsePagination`, que responde 400 — mesma regra das outras listagens.
  const { sort } = (query ?? {}) as Record<string, unknown>;
  return sort === LIKES_SORT;
}

/**
 * Paginação + ordenação da listagem de comentários. Sem `sort=likes` o
 * resultado é idêntico ao das outras listagens (`parsePagination` +
 * `buildOrderBy`); `sort` inválido continua sendo 400.
 */
export function parseCommentListing(query: unknown, options: ListingOptions = {}): CommentListing {
  if (!isLikesSort(query)) {
    const page = parsePagination(query, {
      sortable: SORTABLE_FIELDS.comment,
      ...options,
    });
    return { page, orderBy: buildOrderBy(page) };
  }

  // `sort` sai da query para o helper (ele só entende coluna); `order` também,
  // porque não se aplica: curtidas é sempre "mais curtidos primeiro", e o
  // `meta` reporta essa direção de fato usada.
  const { sort: _sort, order: _order, ...rest } = query as Record<string, unknown>;
  const page = parsePagination(rest, {
    sortable: SORTABLE_FIELDS.comment,
    defaultOrder: 'desc',
  });

  return {
    page: { ...page, sort: LIKES_SORT, order: 'desc' },
    orderBy: ORDER_BY_LIKES,
  };
}

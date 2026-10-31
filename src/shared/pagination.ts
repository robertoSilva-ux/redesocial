import { ValidationError } from './errors.js';

/**
 * Paginação e ordenação por querystring (Exercício 2).
 *
 * Contrato comum a todos os endpoints de listagem:
 *   ?page=1&pageSize=10&sort=createdAt&order=desc
 *
 * Resposta:
 *   { "data": [ ... ], "meta": { page, pageSize, total, totalPages, hasNext, sort, order } }
 *
 * Regras: `page` começa em 1; `pageSize` vale de 1 a 100 (padrão 10);
 * `sort` só aceita os campos da lista branca da entidade (evita 500 por
 * campo inexistente e evita ordenar por coluna que não deveria ser exposta);
 * `order` só aceita "asc" ou "desc" (padrão "desc" = mais recentes primeiro).
 */

export type SortOrder = 'asc' | 'desc';

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number;
  pageSize: number;
  sort: string;
  order: SortOrder;
  skip: number;
  take: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  sort: string;
  order: SortOrder;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

// Campos ordenáveis por entidade (lista branca). Quem não está aqui não pode
// ser usado em `?sort=`, mesmo que exista na tabela.
export const SORTABLE_FIELDS = {
  post: ['createdAt', 'id'],
  comment: ['createdAt', 'id'],
  like: ['createdAt', 'id'],
  profile: ['createdAt', 'id', 'displayName'],
  image: ['createdAt', 'id'],
} as const;

interface ParseOptions {
  sortable: readonly string[];
  defaultSort?: string;
  defaultOrder?: SortOrder;
}

function integerParam(
  raw: unknown,
  label: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (raw === undefined) {
    return fallback;
  }
  // Express entrega `?page=1&page=2` como array; aceitar isso seria ambíguo.
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new ValidationError(`"${label}" deve ser um número inteiro`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ValidationError(`"${label}" deve estar entre ${min} e ${max}`);
  }
  return value;
}

export function parsePagination(query: unknown, options: ParseOptions): PageRequest {
  const params = (query ?? {}) as Record<string, unknown>;
  const defaultSort = options.defaultSort ?? options.sortable[0]!;
  const defaultOrder = options.defaultOrder ?? 'desc';

  const page = integerParam(params.page, 'page', {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 1,
  });
  const pageSize = integerParam(params.pageSize, 'pageSize', {
    min: 1,
    max: MAX_PAGE_SIZE,
    fallback: DEFAULT_PAGE_SIZE,
  });

  let sort = defaultSort;
  if (params.sort !== undefined) {
    if (typeof params.sort !== 'string' || !options.sortable.includes(params.sort)) {
      throw new ValidationError(`"sort" deve ser um destes campos: ${options.sortable.join(', ')}`);
    }
    sort = params.sort;
  }

  let order: SortOrder = defaultOrder;
  if (params.order !== undefined) {
    if (params.order !== 'asc' && params.order !== 'desc') {
      throw new ValidationError('"order" deve ser "asc" ou "desc"');
    }
    order = params.order;
  }

  return { page, pageSize, sort, order, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * `orderBy` do Prisma com desempate por `id`.
 *
 * O desempate não é enfeite: `createdAt` no SQLite tem resolução de SEGUNDO,
 * então várias linhas inseridas no mesmo segundo empatam. Sem um critério
 * estável, a página 2 pode repetir (ou pular) itens que apareceram na página 1.
 */
export function buildOrderBy(page: PageRequest): Record<string, SortOrder>[] {
  const orderBy: Record<string, SortOrder>[] = [{ [page.sort]: page.order }];
  if (page.sort !== 'id') {
    orderBy.push({ id: page.order });
  }
  return orderBy;
}

export function buildPage<T>(rows: T[], total: number, page: PageRequest): Paginated<T> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / page.pageSize);
  return {
    data: rows,
    meta: {
      page: page.page,
      pageSize: page.pageSize,
      total,
      totalPages,
      hasNext: page.page < totalPages,
      sort: page.sort,
      order: page.order,
    },
  };
}

/**
 * Cursor do feed (item 6 do Trabalho II, ADR-0010).
 *
 * Por que cursor composto e não `page/pageSize`: com `offset`, um post novo
 * publicado no topo empurra tudo uma posição — a página 2 repete um item que
 * já apareceu na 1. O cursor aponta para o último item lido, então a próxima
 * consulta continua exatamente de onde parou.
 *
 * O par (`createdAt`, `id`) é necessário porque `createdAt` no SQLite tem
 * resolução de segundo: vários posts empatam, e o `id` é o desempate estável
 * (o mesmo critério do `buildOrderBy`).
 */
export interface FeedCursor {
  createdAt: Date;
  id: number;
}

export function encodeFeedCursor(post: { createdAt: Date; id: number }): string {
  return Buffer.from(`${post.createdAt.toISOString()}|${post.id}`, 'utf8').toString('base64url');
}

export function decodeFeedCursor(raw: unknown): FeedCursor | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ValidationError('"cursor" inválido');
  }

  const texto = Buffer.from(raw, 'base64url').toString('utf8');
  const [iso, idTexto] = texto.split('|');
  const createdAt = new Date(iso ?? '');
  const id = Number(idTexto);

  if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(id) || id <= 0) {
    throw new ValidationError('"cursor" inválido');
  }
  return { createdAt, id };
}

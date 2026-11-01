import type { PrismaClient } from '@prisma/client';

/**
 * "Notificação" simples do item 10 do Trabalho II — não é realtime e não tem
 * fila de eventos: o contador é **derivado** de `createdAt` na hora de renderizar.
 *
 * O que conta como novidade para mim:
 *
 * - curtidas de OUTRAS pessoas nos meus posts;
 * - curtidas de OUTRAS pessoas nos meus comentários;
 * - comentários de OUTRAS pessoas nos meus posts.
 *
 * O que não conta: o que eu mesmo fiz (curtir o próprio post, comentar no meu
 * post), e nada anterior ao `lastSeenAt`.
 *
 * Por que derivar em vez de manter um contador materializado: um contador
 * incremental exigiria atualizar N linhas a cada curtida e teria de ser
 * recalculado em qualquer correção de dados. Três `count()` com `createdAt >
 * lastSeenAt` dão o mesmo número, sempre coerente com o banco, e o índice de
 * `createdAt` cobre a consulta.
 */
export interface NewsCount {
  /** Curtidas de terceiros (nos meus posts + nos meus comentários). */
  likes: number;
  /** Comentários de terceiros nos meus posts. */
  comments: number;
  /** `likes + comments`. */
  total: number;
  /** Instante usado como corte; `null` = primeiro acesso (nada é novo). */
  since: Date | null;
}

export class NotificationController {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lê o contador SEM consumi-lo — quem chama decide se este acesso zera.
   *
   * Primeiro acesso (`lastSeenAt` nulo): devolve zero em vez de contar todo o
   * histórico da conta. Sem baseline anterior, "novo" não significa nada, e um
   * número gigante na primeira tela confunde mais do que informa (ADR-0012).
   */
  async countSince(userId: number): Promise<NewsCount> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastSeenAt: true },
    });

    const since = user?.lastSeenAt ?? null;
    if (!since) {
      return { likes: 0, comments: 0, total: 0, since: null };
    }

    const [curtidasEmPosts, curtidasEmComentarios, comentarios] = await Promise.all([
      this.prisma.like.count({
        where: {
          post: { authorId: userId },
          userId: { not: userId },
          createdAt: { gt: since },
        },
      }),
      this.prisma.like.count({
        where: {
          comment: { authorId: userId },
          userId: { not: userId },
          createdAt: { gt: since },
        },
      }),
      this.prisma.comment.count({
        where: {
          post: { authorId: userId },
          authorId: { not: userId },
          createdAt: { gt: since },
        },
      }),
    ]);

    const likes = curtidasEmPosts + curtidasEmComentarios;
    return { likes, comments: comentarios, total: likes + comentarios, since };
  }

  /**
   * Marca o acesso: a partir daqui o contador recomeça. Chamado só onde o
   * acesso "conta" (abrir o feed), não em toda página — senão ler um post
   * zeraria o aviso antes de a pessoa voltar ao feed.
   */
  async markSeen(userId: number, when: Date = new Date()): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: when } });
  }
}

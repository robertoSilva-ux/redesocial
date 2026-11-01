import type { PrismaClient } from '@prisma/client';
import { buildPage } from '../shared/pagination.js';
import { parseCommentListing } from './commentListing.js';
import { publicUserSelect } from '../shared/selects.js';
import { PostNotFoundError, ValidationError } from '../shared/errors.js';

// Tamanho máximo de um comentário. Não é regra de negócio do enunciado — é
// limite de entrada, para um corpo gigante não ir parar no banco. Fica aqui,
// e não na view, porque a rota também é chamada por `fetch`.
export const MAX_COMMENT_LENGTH = 2000;

export class CommentController {
  constructor(private readonly prisma: PrismaClient) {}

  // GET /comments?page=1&pageSize=10&sort=createdAt&order=desc
  // GET /comments?sort=likes (mais curtidos primeiro — ver commentListing.ts)
  async list(query: unknown) {
    const { page, orderBy } = parseCommentListing(query);

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { replies: true, likes: true } },
        },
        // `orderBy` vem do próprio módulo: `sort=likes` ordena pelo agregado
        // de `Comment.likes`, que não cabe no `buildOrderBy` (ADR-0005).
        orderBy,
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.comment.count(),
    ]);

    return buildPage(comments, total, page);
  }

  /**
   * Comentários de UM post, em ordem cronológica (mais antigo primeiro, que é
   * a ordem em que se lê uma conversa). Paginado pelo mesmo contrato das
   * outras listagens (`{ data, meta }`), porque o feed vai precisar paginar
   * quando um post tiver muita discussão.
   */
  async listByPost(postId: number, query: unknown, options: { viewerId?: number } = {}) {
    await this.assertPostExists(postId);

    const { page, orderBy } = parseCommentListing(query, { defaultOrder: 'asc' });

    const where = { postId };
    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        include: {
          author: { select: publicUserSelect },
          _count: { select: { likes: true, replies: true } },
        },
        // Mesmo motivo do `list`: `sort=likes` é ordenação por relação
        // (ADR-0005). O `count` abaixo usa só o `where`, então o `meta` não
        // depende do `orderBy`.
        orderBy,
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.comment.count({ where }),
    ]);

    // `likedByMe` por comentário, numa consulta só (`in`), como o feed faz.
    // Sem `viewerId` (cliente de API sem sessão) o campo sai `false` em todos —
    // é o mesmo critério do feed para quem não está logado.
    const curtidos = options.viewerId
      ? await this.prisma.like.findMany({
          where: { userId: options.viewerId, commentId: { in: comments.map((c) => c.id) } },
          select: { commentId: true },
        })
      : [];
    const curtidosIds = new Set(curtidos.map((like) => like.commentId));

    return buildPage(
      comments.map((comment) => ({ ...comment, likedByMe: curtidosIds.has(comment.id) })),
      total,
      page,
    );
  }

  /**
   * Cria um comentário. `authorId` vem da SESSÃO (parâmetro), nunca do corpo:
   * é a autorização "você só pode comentar como você mesmo", a mesma regra de
   * `PostController.create` e de `UserController.follow`.
   */
  async create(authorId: number, postId: number, body: unknown) {
    const { content } = (body ?? {}) as { content?: unknown };

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new ValidationError('"content" é obrigatório');
    }

    const text = content.trim();
    if (text.length > MAX_COMMENT_LENGTH) {
      throw new ValidationError(`"content" deve ter no máximo ${MAX_COMMENT_LENGTH} caracteres`);
    }

    await this.assertPostExists(postId);

    return this.prisma.comment.create({
      data: { content: text, authorId, postId },
      include: {
        author: { select: publicUserSelect },
        _count: { select: { likes: true, replies: true } },
      },
    });
  }

  /**
   * Edita o conteúdo de um comentário (atividade 7). A autorização já passou
   * pelo `requireOwnComment` — esta camada não sabe quem está chamando, só
   * aplica a mudança. `updatedAt` é `@updatedAt` no schema, então o Prisma o
   * atualiza sozinho; a view usa isso para marcar "(editado)".
   *
   * A validação é a MESMA do `create` (obrigatório, trim, limite): duplicar a
   * regra em outro método seria a divergência que o trabalho pede para evitar.
   */
  async update(commentId: number, body: unknown) {
    const { content } = (body ?? {}) as { content?: unknown };

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new ValidationError('"content" é obrigatório');
    }

    const text = content.trim();
    if (text.length > MAX_COMMENT_LENGTH) {
      throw new ValidationError(`"content" deve ter no máximo ${MAX_COMMENT_LENGTH} caracteres`);
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content: text },
      include: {
        author: { select: publicUserSelect },
        _count: { select: { likes: true, replies: true } },
      },
    });
  }

  // A checagem "é dono do comentário?" já rodou no middleware
  // `requireOwnComment` (src/auth/middleware.ts), que também devolve 404
  // quando o comentário não existe — por isso aqui o `delete` direto é seguro.
  async remove(commentId: number): Promise<void> {
    await this.prisma.comment.delete({ where: { id: commentId } });
  }

  private async assertPostExists(postId: number): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) {
      throw new PostNotFoundError(postId);
    }
  }
}

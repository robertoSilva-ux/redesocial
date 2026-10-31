import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { CommentNotFoundError, PostNotFoundError } from '../shared/errors.js';
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

  /**
   * Alterna curtir/descurtir um POST e devolve o estado resultante
   * (`{ liked, likeCount }`) lido do banco — o cliente atualiza o DOM com a
   * resposta, não com o que ele acha que aconteceu.
   *
   * Um único método para os dois sentidos porque é assim que o formulário do
   * feed funciona (o mesmo `<form>` serve para curtir e descurtir, decisão do
   * contrato da atividade).
   */
  async togglePostLike(userId: number, postId: number) {
    await this.assertPostExists(postId);

    const existing = await this.prisma.like.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await this.prisma.like.delete({ where: { id: existing.id } });
    } else {
      try {
        await this.prisma.like.create({ data: { userId, postId } });
      } catch (err) {
        // Dois cliques quase simultâneos: o segundo esbarra no
        // @@unique([userId, postId]). O estado que o usuário queria
        // ("curtido") já vale, então engolir o P2002 é melhor que devolver
        // 409 para o navegador — o cliente já trata 409 como sucesso, mas
        // evitar o erro é mais simples que explicá-lo.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }
      }
    }

    return this.postLikeState(userId, postId);
  }

  // Idempotente de propósito: um retry do cliente (rede oscilando) não pode
  // virar erro nem "descurtir duas vezes".
  async unlikePost(userId: number, postId: number) {
    await this.assertPostExists(postId);
    await this.prisma.like.deleteMany({ where: { userId, postId } });
    return this.postLikeState(userId, postId);
  }

  /**
   * Alterna curtir/descurtir um COMENTÁRIO.
   *
   * Mesma mecânica do post porque a tabela é a mesma (ADR-0002): o alvo é
   * exclusivo (post OU comentário, garantido por CHECK na migration), então o
   * que muda aqui é só qual coluna entra no `where` e na contagem.
   */
  async toggleCommentLike(userId: number, commentId: number) {
    await this.assertCommentExists(commentId);

    const existing = await this.prisma.like.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });

    if (existing) {
      await this.prisma.like.delete({ where: { id: existing.id } });
    } else {
      try {
        await this.prisma.like.create({ data: { userId, commentId } });
      } catch (err) {
        // Corrida de duplo clique esbarra no @@unique([userId, commentId]).
        // O estado que o usuário queria já vale — engolir o P2002 é melhor
        // que devolver 409 (mesmo tratamento da curtida em post).
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }
      }
    }

    return this.commentLikeState(userId, commentId);
  }

  // Idempotente: retry do cliente não vira erro nem "descurtir duas vezes".
  async unlikeComment(userId: number, commentId: number) {
    await this.assertCommentExists(commentId);
    await this.prisma.like.deleteMany({ where: { userId, commentId } });
    return this.commentLikeState(userId, commentId);
  }

  private async commentLikeState(userId: number, commentId: number) {
    const [likeCount, mine] = await Promise.all([
      // Curtidas de post têm `commentId` nulo e ficam de fora da contagem.
      this.prisma.like.count({ where: { commentId } }),
      this.prisma.like.findUnique({ where: { userId_commentId: { userId, commentId } } }),
    ]);
    return { liked: mine !== null, likeCount };
  }

  private async assertCommentExists(commentId: number) {
    if (!Number.isInteger(commentId) || commentId <= 0) {
      throw new CommentNotFoundError(commentId);
    }
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
    if (!comment) {
      throw new CommentNotFoundError(commentId);
    }
  }

  private async postLikeState(userId: number, postId: number) {
    const [likeCount, mine] = await Promise.all([
      // Likes de post: os de comentário têm `postId` nulo e ficam de fora.
      this.prisma.like.count({ where: { postId } }),
      this.prisma.like.findUnique({ where: { userId_postId: { userId, postId } } }),
    ]);
    return { liked: mine !== null, likeCount };
  }

  private async assertPostExists(postId: number) {
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new PostNotFoundError(postId);
    }
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new PostNotFoundError(postId);
    }
  }
}

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PostNotFoundError } from '../shared/errors.js';
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

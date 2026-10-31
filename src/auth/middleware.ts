import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { parseIdParam } from '../shared/http.js';

// AUTENTICAÇÃO ("quem é você?"): só verifica se existe uma sessão válida
// com um `userId`. Não olha PARA QUAL recurso a requisição é — só se há
// alguém logado. Toda rota que exige login passa por aqui primeiro.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.redirect('/login');
    return;
  }
  next();
}

// AUTORIZAÇÃO ("você pode fazer ISSO?"): roda DEPOIS de `requireAuth` (já
// sabemos quem é o usuário) e decide se ele pode agir sobre um recurso
// específico — aqui, se o post pertence a quem está logado. Autenticação
// e autorização são perguntas diferentes: um usuário autenticado pode
// ainda assim ser barrado por autorização (ex.: tentar apagar post de
// outra pessoa).
export function requireOwnPost(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Express 4 não captura rejeição de middleware async: sem este try/catch,
    // um id malformado viraria *unhandled rejection* em vez de 400.
    try {
      // Id malformado é erro do cliente (400), não 500 do Prisma — e a validação
      // fica aqui para valer em toda rota que passe por este middleware.
      const postId = parseIdParam(req.params.id);
      const post = await prisma.post.findUnique({ where: { id: postId } });

      if (!post) {
        res.status(404).render('error', { status: 404, message: 'Post não encontrado' });
        return;
      }
      if (post.authorId !== req.session.userId) {
        res.status(403).render('error', { status: 403, message: 'Você não pode apagar um post de outra pessoa' });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

import type { Prisma } from '@prisma/client';

/**
 * Campos de `User` que podem sair do servidor.
 *
 * A regra é negativa e explícita: `passwordHash` **nunca** entra aqui. E
 * nenhum `include` deve usar `author: true` / `user: true`, porque isso traz a
 * linha inteira — foi assim que o hash da senha chegou em `/api/users/:id` e
 * em `author` de `/api/posts/:id` (achado da revisão, cartão E0b).
 *
 * `email` também fica de fora: não é credencial, mas é dado pessoal que nenhuma
 * view usa. Se algum dia precisar, entra em um select próprio, com nome que
 * diga isso (`ownProfileSelect`), e não no select público.
 */
export const publicUserSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

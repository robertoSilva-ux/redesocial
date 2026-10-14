import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

// Registra um usuário e devolve o mesmo `agent` (guarda o cookie de sessão
// entre requisições, como um navegador) já autenticado, mais o id do
// usuário — útil porque POST /register redireciona (302) em vez de
// devolver o usuário criado como JSON.
export async function registerAndLogin(app: Express, prisma: PrismaClient, email: string, name = 'Usuária de teste') {
  const agent = request.agent(app);
  await agent.post('/register').type('form').send({ name, email, password: 'senha123' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { agent, userId: user.id };
}

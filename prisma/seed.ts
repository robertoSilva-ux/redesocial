import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { hashPassword } from '../src/auth/passwords.js';

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Senha de demonstração para os 3 usuários semeados — usem "senha123" para
// testar login em qualquer um deles (ver Aula05/rede-social/README.md).
const DEMO_PASSWORD = 'senha123';

async function main() {
  await prisma.follow.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const [ana, bruno, carla] = await Promise.all([
    prisma.user.create({ data: { name: 'Ana', email: 'ana@exemplo.com', passwordHash } }),
    prisma.user.create({ data: { name: 'Bruno', email: 'bruno@exemplo.com', passwordHash } }),
    prisma.user.create({ data: { name: 'Carla', email: 'carla@exemplo.com', passwordHash } }),
  ]);

  // Autorrelação N:N: Ana e Carla seguem Bruno.
  await prisma.follow.createMany({
    data: [
      { followerId: ana.id, followingId: bruno.id },
      { followerId: carla.id, followingId: bruno.id },
      { followerId: ana.id, followingId: carla.id },
    ],
  });

  // 1:N (autor) + N:N (tags) numa escrita só.
  await prisma.post.create({
    data: {
      content: 'Primeiro post usando Prisma!',
      author: { connect: { id: bruno.id } },
      tags: { connectOrCreate: [{ where: { name: 'prisma' }, create: { name: 'prisma' } }] },
    },
  });

  await prisma.post.create({
    data: {
      content: 'Modelando relações: 1:N, N:N e autorrelação.',
      author: { connect: { id: bruno.id } },
      tags: {
        connectOrCreate: [
          { where: { name: 'prisma' }, create: { name: 'prisma' } },
          { where: { name: 'orm' }, create: { name: 'orm' } },
        ],
      },
    },
  });

  // Post com DUAS fotos, para o feed e a página do post terem o que mostrar
  // sem depender de upload manual. `placehold.co` gera a imagem na hora —
  // nenhum binário entra no repositório (ADR-0007) e a URL funciona no
  // navegador de qualquer máquina.
  await prisma.post.create({
    data: {
      content: 'Duas fotos para testar a relação PostImage (item 4).',
      author: { connect: { id: bruno.id } },
      images: {
        create: [
          { url: 'https://placehold.co/600x400/png?text=foto+1', order: 0 },
          { url: 'https://placehold.co/600x400/png?text=foto+2', order: 1 },
        ],
      },
      tags: { connectOrCreate: [{ where: { name: 'orm' }, create: { name: 'orm' } }] },
    },
  });

  await prisma.post.create({
    data: {
      content: 'ORM não é mágica, é só uma camada.',
      author: { connect: { id: carla.id } },
      tags: { connectOrCreate: [{ where: { name: 'orm' }, create: { name: 'orm' } }] },
    },
  });

  console.log(`Seed concluído: 3 usuários, 4 posts (um com 2 fotos), 2 tags, 3 follows. Senha de todos: "${DEMO_PASSWORD}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

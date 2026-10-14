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

  await prisma.post.create({
    data: {
      content: 'ORM não é mágica, é só uma camada.',
      author: { connect: { id: carla.id } },
      tags: { connectOrCreate: [{ where: { name: 'orm' }, create: { name: 'orm' } }] },
    },
  });

  console.log(`Seed concluído: 3 usuários, 3 posts, 2 tags, 3 follows. Senha de todos: "${DEMO_PASSWORD}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

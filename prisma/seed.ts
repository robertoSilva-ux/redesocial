import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Ordem: filhos antes dos pais (mesma regra do test/helpers/testDb.ts).
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.image.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.address.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany();

  const [ana, bruno, carla] = await Promise.all([
    // prisma client
    // .entidade do banco
    // .operacao
    prisma.user.create({
      data: { name: 'Ana', email: 'ana@exemplo.com', avatarUrl: 'https://exemplo.com/ana.png' },
    }),
    prisma.user.create({ data: { name: 'Bruno', email: 'bruno@exemplo.com' } }),
    prisma.user.create({ data: { name: 'Carla', email: 'carla@exemplo.com' } }),
  ]);

  // 1:1 — um perfil por usuário. Criado um a um porque `createMany` não
  // preenche `updatedAt` (@updatedAt) sozinho.
  await prisma.userProfile.create({
    data: { userId: ana.id, displayName: 'Ana', bio: 'Estudante de TSI', location: 'Canoas' },
  });
  await prisma.userProfile.create({
    data: { userId: bruno.id, displayName: 'Bruno', bio: 'Backend e bancos' },
  });
  await prisma.userProfile.create({ data: { userId: carla.id, isPrivate: true } });

  // Autorrelação N:N: Ana e Carla seguem Bruno.
  await prisma.follow.createMany({
    data: [
      { followerId: ana.id, followingId: bruno.id },
      { followerId: carla.id, followingId: bruno.id },
      { followerId: ana.id, followingId: carla.id },
    ],
  });

  // 1:N (autor) + N:N (tags) numa escrita só.
  const postBruno1 = await prisma.post.create({
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

  const postCarla = await prisma.post.create({
    data: {
      content: 'ORM não é mágica, é só uma camada.',
      author: { connect: { id: carla.id } },
      tags: { connectOrCreate: [{ where: { name: 'orm' }, create: { name: 'orm' } }] },
    },
  });

  // 1:N (post/autor) + autorrelação 1:N (resposta de comentário).
  const comentarioCarla = await prisma.comment.create({
    data: { content: 'Boa! Qual ORM você usou?', authorId: carla.id, postId: postBruno1.id },
  });
  await prisma.comment.create({
    data: {
      content: 'Prisma, com SQLite.',
      authorId: bruno.id,
      postId: postBruno1.id,
      parentId: comentarioCarla.id,
    },
  });
  await prisma.comment.create({
    data: { content: 'Concordo com o post.', authorId: ana.id, postId: postCarla.id },
  });

  // Like: alvo exclusivo — post OU comentário (postId nulo = like em comentário).
  await prisma.like.createMany({
    data: [
      { userId: ana.id, postId: postBruno1.id },
      { userId: carla.id, postId: postBruno1.id },
      { userId: bruno.id, commentId: comentarioCarla.id },
    ],
  });

  // Image: de um usuário, opcionalmente presa a um post.
  await prisma.image.createMany({
    data: [
      { url: 'https://exemplo.com/ana.png', ownerId: ana.id },
      { url: 'https://exemplo.com/bruno-post.png', ownerId: bruno.id, postId: postBruno1.id },
      { url: 'https://exemplo.com/carla-post.png', ownerId: carla.id, postId: postCarla.id },
    ],
  });

  console.log(
    'Seed concluído: 3 usuários, 3 perfis, 3 posts, 2 tags, 3 follows, 3 comentários, 3 likes, 3 imagens.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

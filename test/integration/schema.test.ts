import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';

const prisma: PrismaClient = createTestPrismaClient();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(name: string, email: string) {
  return prisma.user.create({ data: { name, email } });
}

describe('UserProfile (1:1 com User)', () => {
  it('cria perfil ligado ao usuário', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');

    const profile = await prisma.userProfile.create({
      data: { userId: user.id, bio: 'Estudante de TSI' },
    });

    expect(profile.userId).toBe(user.id);
    const loaded = await prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true },
    });
    expect(loaded?.profile?.bio).toBe('Estudante de TSI');
  });

  it('impede dois perfis para o mesmo usuário', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');
    await prisma.userProfile.create({ data: { userId: user.id } });

    await expect(prisma.userProfile.create({ data: { userId: user.id } })).rejects.toThrow(
      /Unique constraint/i,
    );
  });
});

describe('Comment (1:N com Post/User + autorrelação 1:N)', () => {
  it('cria comentário e resposta ligados ao post', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');
    const post = await prisma.post.create({ data: { content: 'post', authorId: user.id } });
    const parent = await prisma.comment.create({
      data: { content: 'raiz', authorId: user.id, postId: post.id },
    });
    await prisma.comment.create({
      data: { content: 'resposta', authorId: user.id, postId: post.id, parentId: parent.id },
    });

    const loaded = await prisma.comment.findUnique({
      where: { id: parent.id },
      include: { replies: true },
    });

    expect(loaded?.replies.map((r) => r.content)).toEqual(['resposta']);
  });

  it('apaga as respostas em cascata ao apagar o comentário raiz', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');
    const post = await prisma.post.create({ data: { content: 'post', authorId: user.id } });
    const parent = await prisma.comment.create({
      data: { content: 'raiz', authorId: user.id, postId: post.id },
    });
    await prisma.comment.create({
      data: { content: 'resposta', authorId: user.id, postId: post.id, parentId: parent.id },
    });

    await prisma.comment.delete({ where: { id: parent.id } });

    expect(await prisma.comment.count()).toBe(0);
  });
});

describe('Like (alvo exclusivo: post OU comentário)', () => {
  it('permite um like por usuário por post e bloqueia o segundo', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');
    const post = await prisma.post.create({ data: { content: 'post', authorId: user.id } });

    await prisma.like.create({ data: { userId: user.id, postId: post.id } });

    await expect(prisma.like.create({ data: { userId: user.id, postId: post.id } })).rejects.toThrow(
      /Unique constraint/i,
    );
  });

  it('permite curtir vários comentários (postId nulo não colide no índice único)', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');
    const post = await prisma.post.create({ data: { content: 'post', authorId: user.id } });
    const c1 = await prisma.comment.create({
      data: { content: 'c1', authorId: user.id, postId: post.id },
    });
    const c2 = await prisma.comment.create({
      data: { content: 'c2', authorId: user.id, postId: post.id },
    });

    await prisma.like.create({ data: { userId: user.id, commentId: c1.id } });
    await prisma.like.create({ data: { userId: user.id, commentId: c2.id } });

    expect(await prisma.like.count()).toBe(2);
  });

  it('rejeita like sem alvo e like com dois alvos (CHECK escrito à mão na migration)', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');
    const post = await prisma.post.create({ data: { content: 'post', authorId: user.id } });
    const comment = await prisma.comment.create({
      data: { content: 'c', authorId: user.id, postId: post.id },
    });

    await expect(prisma.like.create({ data: { userId: user.id } })).rejects.toThrow(
      /CHECK constraint/i,
    );
    await expect(
      prisma.like.create({ data: { userId: user.id, postId: post.id, commentId: comment.id } }),
    ).rejects.toThrow(/CHECK constraint/i);
  });
});

describe('Image (1:N com User, vínculo opcional com Post)', () => {
  it('preserva a imagem e desliga do post quando o post é apagado', async () => {
    const user = await createUser('Ana', 'ana@exemplo.com');
    const post = await prisma.post.create({ data: { content: 'post', authorId: user.id } });
    const image = await prisma.image.create({
      data: { url: 'https://exemplo.com/foto.jpg', ownerId: user.id, postId: post.id },
    });

    await prisma.post.delete({ where: { id: post.id } });

    const loaded = await prisma.image.findUnique({ where: { id: image.id } });
    expect(loaded?.postId).toBeNull();
  });
});

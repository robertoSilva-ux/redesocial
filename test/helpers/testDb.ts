import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { TEST_DATABASE_URL } from '../globalSetup.js';

export function createTestPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: TEST_DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Ordem obrigatória: filhos antes dos pais. Apagar um `User` antes das tabelas
// que o referenciam viola FK; `Comment` tem FK para `Post`, e `Image`/`Like`
// para `Post`, `Comment` e `User`.
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.image.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.address.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany();
}

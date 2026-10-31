-- ADR-0009: `Post.imageUrl` (uma coluna `String?`) vira a relação 1:N
-- `PostImage` (id, url, order, postId), como o item 4 do Trabalho II pede.
--
-- Gerado por `prisma migrate diff --from-schema <schema antigo> --to-schema <novo> --script`
-- e editado à mão para incluir o passo de dados (ADR-0003): o SQL do Prisma
-- cria a tabela e reconstrução de `Post` sem a coluna, mas não move o dado.
--
-- Em banco novo (test.db, CI) a coluna ainda existe neste ponto da cadeia —
-- `init` a criou — então o INSERT roda e não seleciona nada. Em banco com
-- dados, é o passo que preserva a foto dos posts já existentes.

-- CreateTable
CREATE TABLE "PostImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "postId" INTEGER NOT NULL,
    CONSTRAINT "PostImage_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Passo de dados: cada post com foto ganha UMA `PostImage` com `order = 0`.
-- Precisa vir ANTES da reconstrução de `Post` abaixo, que é quem remove a
-- coluna `imageUrl`.
INSERT INTO "PostImage" ("url", "order", "postId")
SELECT "imageUrl", 0, "id" FROM "Post" WHERE "imageUrl" IS NOT NULL;

-- RedefineTables (SQLite não tem DROP COLUMN: reconstrói `Post` sem `imageUrl`)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" INTEGER NOT NULL,
    CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("authorId", "content", "createdAt", "id") SELECT "authorId", "content", "createdAt", "id" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PostImage_postId_order_key" ON "PostImage"("postId", "order");

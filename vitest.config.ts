import { defineConfig } from 'vitest/config';

/**
 * `globalSetup` prepara um banco SQLite dedicado a testes (`test.db`),
 * aplicando as migrations antes da suíte rodar — os testes usam dados
 * reais via Prisma, não mocks (mesma filosofia das Aulas 02/03).
 *
 * `fileParallelism: false` porque todos os arquivos de teste compartilham
 * o mesmo `test.db`: rodar dois arquivos em paralelo faz um `resetDatabase()`
 * apagar dados que o outro arquivo está usando no mesmo instante.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['./test/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/db.ts'],
    },
  },
});

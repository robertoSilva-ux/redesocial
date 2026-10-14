/**
 * Wrapper do `prisma studio` para SQLite (Prisma 7).
 *
 * Por que isso existe:
 * no Prisma 7 o `datasource.url` mora em `prisma.config.ts` e, no SQLite,
 * ele vem como `file:./dev.db` (caminho relativo). O Prisma Studio 0.33
 * (CLI do Prisma 7) rejeita esse formato com:
 *
 *   ! Prisma Studio is not supported for the "file:./dev.db" protocol.
 *
 * O mesmo acontece com `file:dev.db` e com caminhos relativos — só aceita
 * `file://` seguido de um caminho ABSOLUTO. Bug conhecido e aberto:
 * https://github.com/prisma/studio/issues/1578
 *
 * Este script converte o DATABASE_URL do `.env` (relativo) para a forma
 * absoluta `file://...` e chama o Studio com `--url`.
 *
 * Uso: npm run prisma:studio
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL não definida (verifique o .env)');
  process.exit(1);
}

// "file:./dev.db", "file:dev.db" ou "file:///caminho/absoluto" → caminho no disco
const filePath = path.resolve(raw.replace(/^file:(\/\/)?/, ''));

if (!existsSync(filePath)) {
  console.error(`Arquivo do banco não encontrado: ${filePath}`);
  console.error('Rode `npm run prisma:migrate` e `npm run prisma:seed` primeiro.');
  process.exit(1);
}

// o Studio exige file:// + caminho absoluto (no Windows: file:///C:/...)
const url = `file://${filePath.replace(/\\/g, '/')}`;
console.log(`Prisma Studio → ${url}`);

const child = spawn('npx', ['prisma', 'studio', '--url', url], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 0));

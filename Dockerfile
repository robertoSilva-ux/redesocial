# syntax=docker/dockerfile:1

# Imagem de DESENVOLVIMENTO da rede social da Aula 05.
#
# O objetivo aqui é o ambiente: todo mundo roda a mesma versão de Node, com os
# módulos nativos (better-sqlite3 e bcrypt) compilados para o Linux do
# container — nada de "na minha máquina funciona". O código-fonte NÃO é
# congelado na imagem em tempo de execução: o docker-compose.yml monta a pasta
# do projeto por cima de /app, e o `tsx watch` reinicia o servidor a cada
# alteração (ver a seção Docker do README.md).

ARG NODE_VERSION=24-bookworm-slim

# ---------------------------------------------------------------------------
# base — o que é comum a todos os estágios
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base

# openssl é usado pelo motor de migrations do Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=development

# ---------------------------------------------------------------------------
# deps — instala node_modules e compila os módulos nativos para Linux
# ---------------------------------------------------------------------------
FROM base AS deps

# better-sqlite3 e bcrypt são addons nativos (C++). Quando não existe binário
# pré-compilado para esta combinação de Node/plataforma, o npm cai no node-gyp,
# que precisa destas ferramentas.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Copiamos só os manifestos primeiro: enquanto package.json/package-lock.json
# não mudarem, o Docker reaproveita o cache desta camada e não reinstala tudo.
COPY package.json package-lock.json ./

# O `postinstall` do projeto roda `prisma generate`, que lê o schema e o
# prisma.config.ts — por isso eles precisam estar aqui antes do `npm ci`.
COPY prisma.config.ts ./
COPY prisma ./prisma

# `prisma generate` lê a URL do datasource via `env('DATABASE_URL')`
# (prisma.config.ts) e falha se ela não existir. No build não há .env — ele fica
# de fora pelo .dockerignore —, então damos um valor só para esta etapa; quem
# vale em tempo de execução é o do docker-compose.yml.
ENV DATABASE_URL=file:/app/dev.db

RUN npm ci

# ---------------------------------------------------------------------------
# dev — imagem usada pelo docker-compose
# ---------------------------------------------------------------------------
FROM base AS dev

# node_modules vem pronto do estágio anterior, já compilado para Linux.
COPY --from=deps /app/node_modules ./node_modules

# Cópia de cortesia: serve para rodar a imagem sem o bind mount do compose.
# No uso normal (docker compose up) esta cópia fica escondida pelo volume.
COPY . .

RUN chmod +x docker/entrypoint.sh

ENV PORT=3003
EXPOSE 3003

# O entrypoint aplica as migrations antes de entregar o controle ao CMD.
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["npm", "run", "dev:watch"]

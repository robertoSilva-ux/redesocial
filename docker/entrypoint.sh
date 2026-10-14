#!/bin/sh
# Roda toda vez que o container sobe, antes do comando principal (o `CMD` do
# Dockerfile ou o `command:` do docker-compose.yml).
set -e

echo "[entrypoint] DATABASE_URL=${DATABASE_URL}"

# `migrate deploy` aplica as migrations que ainda faltam e não gera nenhuma
# nova (diferente de `migrate dev`) — é o comando certo para um passo
# automático de inicialização: se o banco já está em dia, não faz nada.
echo "[entrypoint] aplicando migrations..."
npx --no prisma migrate deploy

# O seed é DESTRUTIVO (prisma/seed.ts apaga as tabelas antes de recriar os
# dados), então nunca roda sozinho. Para semear:
#   docker compose run --rm -e SEED_ON_START=true app npm run dev:watch
# ou, mais direto:
#   docker compose exec app npm run prisma:seed
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] SEED_ON_START=true — recriando os dados de exemplo..."
  npm run prisma:seed
fi

exec "$@"

import bcrypt from 'bcrypt';

// Custo do hashing: cada +1 dobra o tempo de CPU gasto por hash. 10 é o
// equilíbrio padrão do bcrypt entre segurança (dificultar força bruta) e
// não travar a requisição de cadastro/login por segundos. bcrypt já gera
// e guarda o "salt" dentro do próprio hash de saída — não precisamos
// gerenciar salt manualmente em lugar nenhum do código.
const SALT_ROUNDS = 10;

export function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

// Nunca comparar senha em texto puro com o hash usando `===` — o hash
// muda a cada chamada (salt aleatório) mesmo para a mesma senha. `compare`
// refaz o hash da senha recebida usando o MESMO salt embutido no hash
// salvo, e só então compara os dois hashes.
export function verifyPassword(plainTextPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, passwordHash);
}

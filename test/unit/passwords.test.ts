import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/passwords.js';

describe('hashPassword / verifyPassword', () => {
  it('o hash é diferente da senha em texto puro', async () => {
    const hash = await hashPassword('senha123');
    expect(hash).not.toBe('senha123');
  });

  it('verifyPassword aceita a senha correta', async () => {
    const hash = await hashPassword('senha123');
    await expect(verifyPassword('senha123', hash)).resolves.toBe(true);
  });

  it('verifyPassword rejeita a senha errada', async () => {
    const hash = await hashPassword('senha123');
    await expect(verifyPassword('outra-senha', hash)).resolves.toBe(false);
  });

  it('duas chamadas de hash para a mesma senha geram hashes diferentes (salt aleatório)', async () => {
    const [hashA, hashB] = await Promise.all([hashPassword('senha123'), hashPassword('senha123')]);
    expect(hashA).not.toBe(hashB);
  });
});

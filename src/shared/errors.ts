export class UserNotFoundError extends Error {
  constructor(id: number) {
    super(`Usuário ${id} não encontrado`);
  }
}

export class PostNotFoundError extends Error {
  constructor(id: number) {
    super(`Post ${id} não encontrado`);
  }
}

export class TagNotFoundError extends Error {
  constructor(name: string) {
    super(`Tag "${name}" não encontrada`);
  }
}

export class SelfFollowError extends Error {
  constructor() {
    super('Um usuário não pode seguir a si mesmo');
  }
}

export class DuplicateFollowError extends Error {
  constructor() {
    super('Este usuário já segue o usuário alvo');
  }
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Já existe um usuário com o e-mail ${email}`);
  }
}

export class ValidationError extends Error {}

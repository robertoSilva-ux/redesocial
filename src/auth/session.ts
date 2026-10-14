import session, { type SessionOptions } from 'express-session';

// COMO FUNCIONA O express-session:
// 1. Na primeira requisição, o middleware cria um "session id" aleatório
//    e o guarda num cookie assinado (`connect.sid`) que volta na resposta.
// 2. O navegador reenvia esse cookie em toda requisição seguinte.
// 3. O middleware usa o id do cookie para buscar os dados da sessão no
//    "store" (aqui, em memória — `MemoryStore`, o padrão) e disponibiliza
//    o resultado em `req.session` (um objeto qualquer que a aplicação lê
//    e escreve, ex.: `req.session.userId = user.id`).
//
// O dado sensível nunca fica no cookie: o cookie só carrega o id da sessão.
// Isso é diferente de JWT, onde o próprio token no cliente já carrega os
// dados — aqui, revogar uma sessão (logout, banimento) é só apagar a
// entrada no store, sem precisar de blocklist.
//
// MemoryStore é só para desenvolvimento/aula: os dados somem se o processo
// reiniciar e não escalam para mais de uma instância do servidor. Em
// produção, troca-se por um store compartilhado (Redis, Postgres, etc.) —
// o resto do código não muda, porque `req.session` continua funcionando
// igual.
export function createSessionMiddleware(): ReturnType<typeof session> {
  const options: SessionOptions = {
    // Usado para assinar o cookie (garante que o cliente não pode forjar
    // ou adulterar o id da sessão). Em produção, isso vem de uma variável
    // de ambiente/secret manager — nunca hard-coded como aqui.
    secret: process.env.SESSION_SECRET ?? 'aula05-segredo-de-desenvolvimento',
    resave: false, // não regrava a sessão no store se nada mudou
    saveUninitialized: true, // não cria sessão para visitantes que nunca logaram
    cookie: {
      httpOnly: true, // JavaScript no navegador não consegue ler o cookie (mitiga XSS)
      maxAge: 1000 * 60 * 60 * 24, // 24h
    },
  };
  return session(options);
}

// Aumenta o tipo `express-session` para o TypeScript saber que
// `req.session.userId` existe — sem isso, `SessionData` só tem os campos
// padrão da biblioteca.
declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

/**
 * Item 9 do Trabalho II — `?sort=likes` na listagem de comentários.
 *
 * O comportamento mora em `src/comments/commentListing.ts` (ordenação por
 * relação, fora do `buildOrderBy` — ADR-0005) e vale para as DUAS listagens:
 * `GET /api/comments` e `GET /posts/:id/comments`. Os testes são parametrizados
 * pelos dois endpoints porque um contrato só vale se valer nos dois.
 *
 * Dados do cenário (montados por `cenario()`):
 *
 *   conteúdo        curtidas   createdAt             posição de criação (id)
 *   mais curtido        3      2026-01-01T10:00Z      3ª  ← mais velho, mais curtido
 *   empate novo         2      2026-01-03T10:00Z      1ª  ← id MENOR, data MAIOR
 *   empate antigo       2      2026-01-02T10:00Z      4ª  ← id MAIOR, data MENOR
 *   zero novo           0      2026-01-05T10:00Z      2ª  ← id MENOR, data MAIOR
 *   zero antigo         0      2026-01-04T10:00Z      5ª  ← id MAIOR, data MENOR
 *
 * Os pares empatados têm `id` em ordem OPOSTA à `createdAt` de propósito: se o
 * desempate fosse `id desc` (ou a ordem implícita do SQLite), o par sairia
 * invertido. Só o `createdAt desc` produz a ordem esperada.
 *
 * O comentário mais curtido é o MAIS ANTIGO: uma ordenação só por data o
 * jogaria para o fim, então o cenário 1 também distingue os dois critérios.
 */

const prisma: PrismaClient = createTestPrismaClient();
const app = createServer(prisma, new FakeImageStorage());

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const asJson = { Accept: 'application/json' };

interface EndpointDeListagem {
  nome: string;
  caminho: (postId: number) => string;
  /** Ordem default de `createdAt` quando não há `sort`: desc na API, asc no post. */
  ordemPadrao: 'asc' | 'desc';
}

const ENDPOINTS: EndpointDeListagem[] = [
  { nome: 'GET /api/comments', caminho: () => '/api/comments', ordemPadrao: 'desc' },
  {
    nome: 'GET /posts/:id/comments',
    caminho: (postId) => `/posts/${postId}/comments`,
    ordemPadrao: 'asc',
  },
];

async function listar(endpoint: EndpointDeListagem, postId: number, query = '') {
  const url = endpoint.caminho(postId);
  return request(app)
    .get(query ? `${url}?${query}` : url)
    .set(asJson);
}

interface ComentarioDaResposta {
  id: number;
  content: string;
  createdAt: string;
  _count: { likes: number };
}

function comentariosDe(res: { body: { data: ComentarioDaResposta[] } }): ComentarioDaResposta[] {
  return res.body.data;
}

function idsDe(res: { body: { data: ComentarioDaResposta[] } }): number[] {
  return comentariosDe(res).map((c) => c.id);
}

/** `[{ content, likes }]` — deixa o assert legível quando a ordem é o objeto do teste. */
function resumoDe(res: { body: { data: ComentarioDaResposta[] } }) {
  return comentariosDe(res).map((c) => ({ content: c.content, likes: c._count.likes }));
}

/**
 * Autor (dono do post), um comentarista e três curtidores — as curtidas vêm
 * pela rota real (`POST /comments/:id/like`), então a contagem que o teste lê
 * é a mesma que um cliente produziria. Três usuários distintos porque o
 * schema garante um like por usuário e alvo.
 */
async function cenario() {
  const autor = await registerAndLogin(app, prisma, 'autor@exemplo.com', 'Autor');
  await autor.agent.post('/posts').type('form').send({ content: 'post do cenário' });
  const post = await prisma.post.findFirstOrThrow({ where: { content: 'post do cenário' } });

  const comentarista = await registerAndLogin(app, prisma, 'comentarista@exemplo.com', 'Comentarista');

  // Ordem de criação escolhida para que o `id` NÃO seja o desempate correto.
  const naOrdemDeCriacao = ['empate novo', 'zero novo', 'mais curtido', 'empate antigo', 'zero antigo'];
  const ids: Record<string, number> = {};
  for (const content of naOrdemDeCriacao) {
    const criado = await comentarista.agent
      .post(`/posts/${post.id}/comments`)
      .set(asJson)
      .send({ content });
    expect(criado.status, `criação do comentário "${content}"`).toBe(201);
    ids[content] = criado.body.id;
  }

  // `createdAt` explícito: a coluna tem resolução de SEGUNDO, então cinco
  // comentários criados em sequência empatariam também na data e o teste não
  // provaria o critério de desempate. Mesmo recurso de `feed-pagination.test.ts`.
  const datam = {
    'mais curtido': '2026-01-01T10:00:00.000Z',
    'empate antigo': '2026-01-02T10:00:00.000Z',
    'empate novo': '2026-01-03T10:00:00.000Z',
    'zero antigo': '2026-01-04T10:00:00.000Z',
    'zero novo': '2026-01-05T10:00:00.000Z',
  } as const;
  for (const [content, iso] of Object.entries(datam)) {
    await prisma.comment.update({
      where: { id: ids[content]! },
      data: { createdAt: new Date(iso) },
    });
  }

  const curtidores = [];
  for (let i = 0; i < 3; i += 1) {
    const { agent } = await registerAndLogin(app, prisma, `curtidor${i}@exemplo.com`, `Curtidor ${i}`);
    curtidores.push(agent);
  }

  const curtidas: Array<[string, number]> = [
    ['mais curtido', 3],
    ['empate novo', 2],
    ['empate antigo', 2],
  ];
  for (const [content, quantidade] of curtidas) {
    for (const agent of curtidores.slice(0, quantidade)) {
      const curtida = await agent.post(`/comments/${ids[content]}/like`).set(asJson);
      expect(curtida.status, `curtida em "${content}"`).toBe(200);
    }
  }

  const ordem = {
    /** Esperado com `sort=likes`: curtidas desc, depois createdAt desc. */
    likes: ['mais curtido', 'empate novo', 'empate antigo', 'zero novo', 'zero antigo'].map(
      (content) => ids[content]!,
    ),
    /** Default da API (`createdAt desc, id desc`). */
    createdAtDesc: ['zero novo', 'zero antigo', 'empate novo', 'empate antigo', 'mais curtido'].map(
      (content) => ids[content]!,
    ),
    /** Default de `GET /posts/:id/comments` (`createdAt asc, id asc`). */
    createdAtAsc: ['mais curtido', 'empate antigo', 'empate novo', 'zero antigo', 'zero novo'].map(
      (content) => ids[content]!,
    ),
  };

  return { autor, comentarista, post, ids, curtidores, ordem };
}

describe.each(ENDPOINTS)('$nome — ?sort=likes', (endpoint) => {
  it('cenário 1: o comentário com mais curtidas aparece primeiro', async () => {
    const { post, ids, ordem } = await cenario();

    const res = await listar(endpoint, post.id, 'sort=likes');

    expect(res.status).toBe(200);
    // "Primeiro" aqui é o primeiro da resposta, não o mais recente nem o de maior id.
    expect(idsDe(res)[0]).toBe(ids['mais curtido']!);
    // E a lista inteira é curtidas desc — a ordem é o conteúdo do teste.
    expect(resumoDe(res)).toEqual([
      { content: 'mais curtido', likes: 3 },
      { content: 'empate novo', likes: 2 },
      { content: 'empate antigo', likes: 2 },
      { content: 'zero novo', likes: 0 },
      { content: 'zero antigo', likes: 0 },
    ]);
    expect(idsDe(res)).toEqual(ordem.likes);
  });

  it('cenário 2: empate em curtidas é desempatado por createdAt desc, de forma determinística', async () => {
    const { post, ordem } = await cenario();

    const primeira = await listar(endpoint, post.id, 'sort=likes');
    const segunda = await listar(endpoint, post.id, 'sort=likes');

    expect(primeira.status).toBe(200);
    // Os dois comentários com 2 curtidas: o de `createdAt` MAIOR vem antes,
    // mesmo tendo `id` MENOR (o `id desc` daria o contrário).
    const empatados = resumoDe(primeira).filter((c) => c.likes === 2);
    expect(empatados.map((c) => c.content)).toEqual(['empate novo', 'empate antigo']);
    // Ordem completa, duas execuções: mesma resposta nas duas.
    expect(idsDe(primeira)).toEqual(ordem.likes);
    expect(idsDe(segunda)).toEqual(idsDe(primeira));
    expect(resumoDe(segunda)).toEqual(resumoDe(primeira));
  });

  it('cenário 3: comentários com zero curtidas vão para o fim, também desempatados por createdAt desc', async () => {
    const { post, ordem } = await cenario();

    const res = await listar(endpoint, post.id, 'sort=likes');
    const lista = resumoDe(res);

    expect(res.status).toBe(200);
    // Nenhum comentário sem curtida antes de um comentado.
    const primeiroComCurtida = lista.findIndex((c) => c.likes > 0);
    const ultimoSemCurtida = lista.map((c) => c.likes).lastIndexOf(0);
    expect(lista.some((c) => c.likes > 0)).toBe(true);
    expect(lista.some((c) => c.likes === 0)).toBe(true);
    expect(primeiroComCurtida).toBeGreaterThanOrEqual(0);
    expect(ultimoSemCurtida).toBeGreaterThan(primeiroComCurtida);
    // Os DOIS zeros no fim, e entre eles vale o mesmo desempate (data desc,
    // contra a ordem dos ids).
    expect(lista.slice(-2)).toEqual([
      { content: 'zero novo', likes: 0 },
      { content: 'zero antigo', likes: 0 },
    ]);
    expect(idsDe(res)).toEqual(ordem.likes);
  });

  it('cenário 4: envelope { data, meta } preservado e meta coerente com a paginação', async () => {
    const { post, ordem } = await cenario();

    const pagina2 = await listar(endpoint, post.id, 'sort=likes&page=2&pageSize=2');

    expect(pagina2.status).toBe(200);
    // Envelope: exatamente as duas chaves do contrato (ADR-0005).
    expect(Object.keys(pagina2.body as object).sort()).toEqual(['data', 'meta']);
    expect(pagina2.body.data).toHaveLength(2);
    expect(idsDe(pagina2)).toEqual(ordem.likes.slice(2, 4));
    // `total` é o total do FILTRO (5 comentários), não o tamanho da página.
    expect(pagina2.body.meta).toEqual({
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
      sort: 'likes',
      order: 'desc',
    });

    // Concatenar as três páginas devolve a lista completa, sem repetir nem pular.
    const paginas = [];
    for (const page of [1, 2, 3]) {
      const res = await listar(endpoint, post.id, `sort=likes&page=${page}&pageSize=2`);
      expect(res.body.meta.page).toBe(page);
      paginas.push(...idsDe(res));
    }
    expect(paginas).toEqual(ordem.likes);
  });

  it('cenário 5: sem sort a ordenação default continua a mesma (e meta a reporta)', async () => {
    const { post, ordem } = await cenario();

    const semSort = await listar(endpoint, post.id);
    const explicito = await listar(endpoint, post.id, `sort=createdAt&order=${endpoint.ordemPadrao}`);

    expect(semSort.status).toBe(200);
    expect(semSort.body.meta).toMatchObject({ sort: 'createdAt', order: endpoint.ordemPadrao });
    // Default esperado: createdAt na direção histórica do endpoint (desc na
    // API, asc no post) — que é o OPOSTO de "mais curtido primeiro".
    expect(idsDe(semSort)).toEqual(
      endpoint.ordemPadrao === 'desc' ? ordem.createdAtDesc : ordem.createdAtAsc,
    );
    expect(idsDe(semSort)).not.toEqual(ordem.likes);
    // `?sort=createdAt&order=<default>` é o mesmo caminho de antes.
    expect(idsDe(explicito)).toEqual(idsDe(semSort));
  });

  it('cenário 5: sort inválido (?sort=banana) continua 400 e não vira ordenação por curtidas', async () => {
    const { post } = await cenario();

    const res = await listar(endpoint, post.id, 'sort=banana');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"sort" deve ser um destes campos: createdAt, id/);
    // O 400 é do parse: não existe `data` com a lista ordenada por curtidas.
    expect(res.body.data).toBeUndefined();
  });
});

describe('GET /posts/:id/comments — ?sort=likes e o filtro do post', () => {
  it('meta.total e a lista contam só os comentários daquele post (não a tabela inteira)', async () => {
    const { autor, post, curtidores } = await cenario();

    // Comentário de OUTRO post, mais curtido que qualquer um do post filtrado:
    // se o `where` vazasse para o `count`/`findMany`, ele apareceria em primeiro.
    await autor.agent.post('/posts').type('form').send({ content: 'outro post' });
    const outroPost = await prisma.post.findFirstOrThrow({ where: { content: 'outro post' } });
    const alheio = await autor.agent
      .post(`/posts/${outroPost.id}/comments`)
      .set(asJson)
      .send({ content: 'comentário de outro post' });
    for (const agent of curtidores) {
      await agent.post(`/comments/${alheio.body.id}/like`).set(asJson);
    }

    const res = await request(app)
      .get(`/posts/${post.id}/comments?sort=likes&pageSize=10`)
      .set(asJson);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(5);
    expect(comentariosDe(res).map((c) => c.content)).not.toContain('comentário de outro post');
    expect(res.body.meta.totalPages).toBe(1);
    expect(res.body.meta.hasNext).toBe(false);
  });
});

describe('toggle de ordenação na página do post (item 9, sem e com JS)', () => {
  it('sem JS: GET /posts/:id?sort=likes renderiza os comentários por curtidas', async () => {
    const { autor, post, ordem } = await cenario();

    const cronologica = await autor.agent.get(`/posts/${post.id}`);
    const curtidas = await autor.agent.get(`/posts/${post.id}?sort=likes`);

    expect(cronologica.status).toBe(200);
    expect(curtidas.status).toBe(200);

    // Lendo só os <li data-comment-id> da lista, na ordem em que aparecem.
    const idsNaPagina = (html: string) => {
      const lista = html.slice(html.indexOf('data-comment-list'));
      return Array.from(lista.matchAll(/data-comment-id="(\d+)"/g)).map((m) => Number(m[1]));
    };

    expect(idsNaPagina(cronologica.text)).toEqual(ordem.createdAtAsc);
    expect(idsNaPagina(curtidas.text)).toEqual(ordem.likes);
    // O estado ativo vem do servidor: o link de curtidas é o "ligado".
    expect(curtidas.text).toMatch(/data-comment-sort="likes"[^>]*|mais curtidos/);
  });

  it('com JS: o fragmento HTML vem ordenado e sem envelope', async () => {
    const { autor, post, ordem } = await cenario();

    const res = await autor.agent
      .get(`/posts/${post.id}/comments?sort=likes`)
      .set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.headers['x-total']).toBe('5');
    expect(res.text).not.toMatch(/<html/i);
    expect(res.text).not.toContain('"data"'); // é fragmento, não JSON

    const ids = Array.from(res.text.matchAll(/data-comment-id="(\d+)"/g)).map((m) => Number(m[1]));
    expect(ids).toEqual(ordem.likes);
  });

  it('o mesmo endpoint continua JSON quando o cliente pede JSON', async () => {
    const { autor, post, ordem } = await cenario();

    const res = await autor.agent.get(`/posts/${post.id}/comments?sort=likes`).set(asJson);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(Object.keys(res.body as object).sort()).toEqual(['data', 'meta']);
    expect(idsDe(res)).toEqual(ordem.likes);
    // `likedByMe` agora vem na listagem — a página do post desenha o botão com ele.
    expect(comentariosDe(res).every((c) => typeof (c as { likedByMe?: boolean }).likedByMe === 'boolean')).toBe(true);
  });

  it('sem sessão o fragmento HTML não é servido (não há `likedByMe` para desenhar)', async () => {
    const { post } = await cenario();

    const res = await request(app).get(`/posts/${post.id}/comments?sort=likes`).set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

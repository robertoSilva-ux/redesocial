# ADR-0005 — Paginação e ordenação com o mesmo contrato em todas as listagens

- **Status:** Aceita
- **Data:** 2026-10-13
- **Decisores:** Roberto (autor do projeto)

## Contexto

O Exercício 2 da Aula 04 pediu paginação e ordenação em **todas** as listagens (`Post`, `Comment`, `Like`, `UserProfile`, `Image`). Havíamos de ter cinco formatos diferentes, cada Controller inventando seu `?page`, seu envelope e seu jeito de validar `sort` — e um `sort=colunaQueNaoExiste` virando erro 500 do Prisma em vez de 400.

O feed infinito do Trabalho II (item 6) vai precisar de paginação também, e vai precisar dela enquanto o usuário rola a tela.

## Decisão

Um contrato único, implementado em `src/shared/pagination.ts` e usado por todos os Controllers:

```
GET /api/<recurso>?page=1&pageSize=10&sort=createdAt&order=desc
→ { data: [...], meta: { page, pageSize, total, totalPages, hasNext, sort, order } }
```

- `page` começa em 1; `pageSize` é 1..100 com padrão 10; `order` só `asc`/`desc` (padrão `desc` =
  mais recentes primeiro);
- `sort` é validado contra uma **lista branca por entidade** (`SORTABLE_FIELDS`), não contra o schema inteiro: campo fora da lista é `400 ValidationError`, e coluna que não deveria ser exposta não pode ser usada como critério de ordenação;
- entrada inválida é `400`, nunca `500` (commit `505aeef`).

## Alternativas consideradas

- **Paginação por cursor** (`?cursor=<id>&limit=10`). É a escolha certa para *scroll* infinito:
  não desloca resultados quando um post novo entra no topo, e o custo não cresce com a
  profundidade. Foi descartada **para a API de leitura** porque `page/pageSize` casa com "página 3
  de 7" e com o que o Exercício 2 pediu. Fica registrada como a segunda opção legítima para o feed do Trabalho II.
- **`skip`/`take` cru em cada Controller.** É o que este ADR elimina.
- **Sem paginação.** A listagem carrega tudo; funciona com 3 registros e não com 3 mil.

## Consequências

### Positivas

- Um teste cobre o contrato para todas as listagens (`test/integration/pagination.test.ts`).
- `sort` em lista branca elimina a classe de bug "parâmetro de query derruba o servidor".
- O cliente do feed pode reaproveitar o mesmo envelope quando o scroll infinito chegar.

### Negativas / custos

- `skip`/`take` fica caro em offsets grandes (SQLite varre as linhas puladas) — irrelevante nesta escala, mas é o motivo técnico pelo qual cursor ganha em feed.
- **Dois estilos de paginação vão conviver**: `page/pageSize` na API, cursor no feed (se essa for a escolha do item 6). A fronteira precisa estar documentada, senão vira inconsistência sem dono.
- O envelope `{ data, meta }` é diferente do array cru que a Aula 04 devolvia — os testes antigos tiveram que ser adaptados (commit `9787401`), e qualquer cliente novo precisa saber disso.

### Riscos e mitigação

- **Ordenar por relação** (`_count.likes`, exigido pelo item 9 do Trabalho II) não cabe no `buildOrderBy` atual, que monta `orderBy` a partir de uma coluna. Mitigação: quando o item 9 entrar, a ordenação por contagem vira uma consulta própria no módulo `comments/`, e este ADR é citado como a razão de ela não passar pelo helper.

## Referências

- `src/shared/pagination.ts`, `test/integration/pagination.test.ts`
- `src/routes.ts` (listagens em `/api`)
- `README.md` → "Listagens (todas paginadas e ordenáveis — Exercício 2)"

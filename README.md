# 🗳️ eVoto — Sistema de Votação Electrónica Seguro

Plataforma full-stack de votação electrónica com **voto secreto**, **boletins cifrados**, **recibos verificáveis** e **registo de auditoria à prova de adulteração**.

| Camada | Tecnologias |
|---|---|
| Frontend | React 19 · Vite 8 · TypeScript · React Router · TanStack Query 5 · Tailwind CSS 4 · lucide-react |
| Backend | Node.js 22 · Express 5 · TypeScript · Zod 4 · better-sqlite3 (WAL) · Argon2id · Helmet · express-rate-limit · Pino |
| Qualidade | Vitest + Supertest (API) · Playwright (E2E) · GitHub Actions |
| Deploy | Dockerfile multi-stage (utilizador não-root, FS só de leitura) · docker-compose |

---

## Início rápido

```bash
npm install
npm run seed:demo        # cria admin + 3 eleitores + eleição de exemplo
npm run dev              # API em :4000, frontend em http://localhost:5173
```

Contas de demonstração (apenas desenvolvimento):

| Perfil | Email | Palavra-passe |
|---|---|---|
| Administrador | `admin@evoto.local` | `Admin12345!` |
| Eleitor | `eleitor1@evoto.local` (…2, …3) | `Eleitor12345` |

Em desenvolvimento, se as chaves não estiverem definidas, são geradas e guardadas em `server/data/.dev-keys.json`.

### Produção

```bash
cp .env.example .env
# preencher BALLOT_ENCRYPTION_KEY e IDENTITY_PEPPER com:  openssl rand -hex 32
# definir CLIENT_ORIGIN=https://o-seu-dominio.pt  e  TRUST_PROXY=1 (se atrás de proxy)
docker compose up -d --build
docker compose exec -e ADMIN_EMAIL=admin@evoto.local -e ADMIN_PASSWORD=Admin12345! evoto node server/dist/seed.js
```

Sem Docker: `npm run build && npm start` (o Express serve o frontend compilado). Coloque sempre um proxy com **HTTPS** (Nginx, Caddy, Traefik) à frente.

---

## Funcionalidades

**Eleitor** — registo (validado por administrador), login, lista de eleições, boletim com confirmação em dois passos, voto em branco opcional, recibo de voto (copiar/descarregar), verificação pública do recibo, resultados após encerramento, alteração de palavra-passe.

**Administrador** — painel com estatísticas e estado da cadeia de auditoria, validação/suspensão de eleitores e gestão de administradores, criação/edição de eleições em rascunho, gestão de candidatos, publicação, encerramento antecipado com apuramento, consulta do registo de auditoria.

---

## Modelo de segurança

| Ameaça | Mitigação |
|---|---|
| Ligar eleitor ↔ voto | `participations` (quem votou) e `ballots` (o quê) são tabelas separadas sem timestamps; boletins em tabela `WITHOUT ROWID` com chave UUID aleatória (a ordem física não revela a ordem de voto); a entrada `ballot.cast` na auditoria não regista autor nem IP. |
| Leitura da BD / backups | Escolha cifrada com **AES-256-GCM**, texto de tamanho fixo (o tamanho não revela a opção) e ID da eleição como AAD (um boletim não pode ser movido para outra eleição). |
| Voto duplo / concorrência | Chave primária `(election_id, user_id)` + transacção atómica participação+boletim. Testado com 5 pedidos simultâneos. |
| Resultados parciais | Resultados só são divulgados após o encerramento; o apuramento verifica que nº boletins = nº participações. |
| Adulteração de dados | Registo de auditoria **encadeado por SHA-256** (verificado em tempo real no painel); hash dos resultados e resumo do quadro de boletins publicados. |
| Verificabilidade individual | Recibo aleatório de 80 bits; o servidor guarda só `SHA-256(eleição:recibo)`; qualquer pessoa confirma a inclusão sem revelar o voto. |
| Roubo de palavras-passe | **Argon2id** (parâmetros OWASP), política mínima, bloqueio de 15 min após 5 falhas, tempo de resposta uniforme (sem enumeração de contas). |
| Sequestro de sessão | Sessões opacas (256 bits) guardadas como hash, revogáveis; cookie `HttpOnly`, `Secure`, `SameSite=Strict`, prefixo `__Host-` em produção. |
| CSRF | SameSite=Strict + cabeçalho obrigatório `X-Requested-With` + validação de `Origin`. |
| XSS / clickjacking | React (escape automático), CSP restritiva, `frame-ancestors 'none'`, HSTS em produção (Helmet). |
| Força bruta / DoS | Rate limiting em login, registo, voto e verificação; limite de 32 KB no corpo JSON. |
| Dados pessoais | Nº de documento guardado apenas como **HMAC-SHA256 com pepper** (unicidade sem guardar o valor). |
| Injecção | Validação Zod em todas as entradas; SQL sempre parametrizado. |

### Limitações conhecidas (e próximos passos)

Este sistema adequa-se a eleições **internas** (associações, sindicatos, condomínios, empresas, universidades). Para eleições públicas vinculativas seriam necessários, entre outros:

- **Cifra homomórfica / threshold** (ex.: ElGamal com chave partilhada entre vários escrutinadores) para que nenhuma entidade isolada consiga decifrar boletins; hoje quem tiver a `BALLOT_ENCRYPTION_KEY` e acesso à BD consegue ler os boletins (mas não associá-los a eleitores).
- Autenticação forte (Chave Móvel Digital / Cartão de Cidadão, WebAuthn/passkeys, 2FA TOTP).
- Resistência a coerção (possibilidade de re-voto, votação presencial de último recurso).
- HSM/KMS para as chaves, PostgreSQL com réplicas, auditoria externa e certificação.

---

## Estrutura

```
evoto/
├── server/                 API Express 5 (TypeScript)
│   └── src/
│       ├── app.ts          middleware de segurança e rotas
│       ├── config.ts       validação de variáveis de ambiente (Zod)
│       ├── db.ts           SQLite + migrações versionadas
│       ├── crypto.ts       AES-GCM, recibos, HMAC
│       ├── audit.ts        registo encadeado por hash
│       ├── http.ts         sessões, CSRF, erros
│       ├── routes/         auth · elections · admin
│       ├── services/       apuramento
│       ├── seed.ts         admin inicial / dados demo
│       └── app.test.ts     testes de integração
├── client/                 React 19 + Vite
│   └── src/{components,lib,pages}
├── e2e/flow.mjs            teste ponta-a-ponta (Playwright)
├── Dockerfile · docker-compose.yml · .github/workflows/ci.yml
```

## API (resumo)

| Método | Rota | Acesso |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` · `/change-password` | público / sessão |
| GET | `/api/auth/me` | público |
| GET | `/api/elections` · `/:id` · `/:id/results` · `/:id/bulletin` | público |
| POST | `/api/elections/:id/verify-receipt` | público |
| POST | `/api/elections/:id/vote` | eleitor aprovado |
| GET/PATCH | `/api/admin/users[/:id]` | admin |
| GET/POST/PUT/DELETE | `/api/admin/elections[/:id]` · `/candidates` · `/publish` · `/close` | admin |
| GET | `/api/admin/stats` · `/api/admin/audit` | admin |

Todos os pedidos não-GET exigem o cabeçalho `X-Requested-With: evoto`.

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | API + frontend com hot reload |
| `npm test` | testes de integração da API |
| `npm run typecheck` | verificação de tipos (server + client) |
| `npm run build` / `npm start` | build e arranque em produção |
| `npm run seed` / `seed:demo` | admin inicial / dados de demonstração |
| `cd e2e && npm i && BASE=http://localhost:4000 npm test` | fluxo E2E no browser |

## Capturas de ecrã

| Boletim | Recibo | Resultados |
|---|---|---|
| ![](docs/screenshots/2-boletim.png) | ![](docs/screenshots/3-recibo.png) | ![](docs/screenshots/6-resultados.png) |

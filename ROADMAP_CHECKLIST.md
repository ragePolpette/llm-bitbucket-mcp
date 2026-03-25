# llm-bitbucket-mcp Roadmap Checklist

## Goal

Portare questo repo da prototipo funzionante a tool locale/internal-grade:

- sicuro per uso personale o team ristretto
- ben strutturato e credibile come portfolio pubblico
- orientato a pratiche enterprise, senza costruire infrastruttura inutile

## Operating Model

Ogni item completato segue questo workflow:

1. creare branch feature dedicato
2. implementare scope piccolo e coerente
3. eseguire check locali
4. push del branch
5. aprire PR
6. fare merge
7. aggiornare questo file segnando il task come completato e aggiungendo riferimento PR

Convention suggerita per i branch:

- `feature/<topic>`
- `fix/<topic>`
- `chore/<topic>`

## Status Legend

- `[ ]` da fare
- `[~]` in corso
- `[x]` completato

## Recommended Execution Order

Partire da questa sequenza:

1. P0.1 Quality baseline
2. P0.2 Config and runtime hardening
3. P0.3 API boundary hardening
4. P0.4 Test expansion
5. P0.5 README and portfolio polish

## Phase P0: Must Have For Portfolio

### P0.1 Quality Baseline

- [x] Aggiungere `eslint` e configurazione minima per ESM Node
- [x] Aggiungere `prettier`
- [x] Aggiungere script `lint`, `format`, `check`
- [x] Aggiungere file di versione runtime come `.nvmrc` oppure documentare versione Node in modo piu' rigoroso
- [x] Aggiungere CI minima per eseguire install, lint e test a ogni PR

Definition of done:

- `npm run lint` passa
- `npm test` passa
- esiste una pipeline automatica nel repo

Notes:

- branch: `feature/quality-baseline`
- PR: `#5`
- merged on: `2026-03-25`

### P0.2 Config And Runtime Hardening

- [x] Validare la config all'avvio con schema esplicito
- [x] Rendere `MCP_BB_SESSION_TTL_MS` sicuro di default
- [x] Introdurre un limite massimo alle sessioni in memoria
- [x] Ridurre il payload del `/health`
- [x] Migliorare messaggi di errore di startup e configurazione

Definition of done:

- avvio fallisce in modo chiaro su config invalida
- le sessioni non restano infinite per default
- `/health` non espone dettagli superflui

Notes:

- branch: `feature/config-runtime-hardening`
- PR: `#6`
- merged on: `2026-03-25`

### P0.3 API Boundary Hardening

- [x] Restringere `bb_api` a endpoint consentiti o a un perimetro esplicito
- [x] Aggiungere validazione input runtime nei tool handler
- [x] Introdurre limiti di lunghezza per input testuali sensibili
- [x] Rendere `bb_clone` piu' prevedibile e non-interactive quando possibile
- [x] Rivedere i default dei tool write per evitare comportamenti ambigui

Definition of done:

- `bb_api` non e' piu' un escape hatch quasi totale
- i payload invalidi falliscono presto con errori chiari
- i tool di scrittura hanno contratti piu' stretti

Notes:

- branch: `feature/api-boundary-hardening`
- PR: `#7`
- merged on: `2026-03-25`

### P0.4 Test Expansion

- [x] Aggiungere test su startup/config invalid
- [x] Aggiungere test sul lifecycle delle sessioni
- [x] Aggiungere test su CORS/origin validation
- [x] Aggiungere test su limiti e restrizioni di `bb_api`
- [x] Aggiungere almeno un test HTTP end-to-end sul server

Definition of done:

- i casi core del server sono coperti oltre ai mock dei singoli handler
- esiste almeno un test che passa attraverso l'app HTTP reale

Notes:

- branch: `feature/test-expansion`
- PR: `#8`
- merged on: `2026-03-25`

### P0.5 README And Portfolio Polish

- [x] Riscrivere README con overview architetturale
- [x] Documentare chiaramente scope, boundary e non-goals
- [x] Aggiungere esempi di uso reali dei tool MCP
- [x] Documentare security posture proporzionata a tool locale/internal
- [x] Aggiungere sezione roadmap che punti a questo file

Definition of done:

- il repo si capisce in pochi minuti
- un reviewer esterno vede confini chiari e scelte deliberate

Notes:

- branch: `feature/readme-portfolio-polish`
- PR: `#9`
- merged on: `2026-03-25`

## Phase P1: Should Have For Internal Team Use

### P1.1 Observability Lite

- [ ] Introdurre correlation id per request/tool call
- [ ] Rendere i log piu' uniformi e meno rumorosi nei test
- [ ] Distinguere meglio eventi runtime, warning ed errori

### P1.2 Safer Git And Clone Operations

- [ ] Esplicitare meglio strategia SSH/HTTPS nel README
- [ ] Gestire errori di clone in modo piu' pulito e prevedibile
- [ ] Valutare opzione clone shallow o parametri controllati

### P1.3 Better Product Structure

- [ ] Separare bootstrap server e app factory per testabilita'
- [ ] Centralizzare costanti e policy di sicurezza
- [ ] Ridurre logica sparsa tra config, handler e server

### P1.4 More Complete Tool Surface

- [ ] Valutare se aggiungere altri tool read-only utili
- [ ] Lasciare i tool distruttivi fuori dal surface finche' non hanno policy e test adeguati
- [ ] Rifinire naming e descrizioni dei tool per MCP discovery

## Phase P2: Enterprise-Oriented Future

Questa fase non e' necessaria subito, ma tiene aperta la direzione giusta.

### P2.1 Security And Governance

- [ ] API key interna o auth leggera per ambienti condivisi
- [ ] Audit trail piu' completo per operazioni write
- [ ] Policy piu' rigide su tool sensibili

### P2.2 Packaging And Distribution

- [ ] Dockerfile minimale
- [ ] release notes o changelog
- [ ] versione semantica e processo di release piu' ordinato

### P2.3 Advanced Reliability

- [ ] retry/backoff mirato per Bitbucket API
- [ ] metriche runtime essenziali
- [ ] test di integrazione contro sandbox controllata

## First Development Slice

Task consigliato per iniziare:

- `P0.1 Quality Baseline`

Branch suggerito:

- `feature/quality-baseline`

Output atteso del primo ciclo:

- lint e format attivi
- script npm puliti
- CI base presente

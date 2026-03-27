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
- [x] Rendere i tool utility piu' prevedibili e con boundary piu' stretti
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

- [x] Introdurre correlation id per request/tool call
- [x] Rendere i log piu' uniformi e meno rumorosi nei test
- [x] Distinguere meglio eventi runtime, warning ed errori

Notes:

- branch: `feature/observability-lite`
- PR: `#10`
- merged on: `2026-03-26`

### P1.2 Tool Surface Simplification

- [x] Rimuovere `bb_clone` dal surface MCP pubblico
- [x] Eliminare config e runtime path residue legate al clone locale
- [x] Allineare README, test e boundary di prodotto al focus su PR/API repository-scoped

Notes:

- branch: `feature/safer-clone-operations`
- PR: `#11`
- merged on: `2026-03-26`

### P1.3 Better Product Structure

- [x] Separare bootstrap server e app factory per testabilita'
- [x] Centralizzare costanti e policy di sicurezza
- [x] Ridurre logica sparsa tra config, handler e server

Notes:

- branch: `feature/product-structure`
- PR: `#12`
- merged on: `2026-03-26`

### P1.4 More Complete Tool Surface

- [x] Valutare se aggiungere altri tool read-only utili
- [x] Lasciare i tool distruttivi fuori dal surface finche' non hanno policy e test adeguati
- [x] Rifinire naming e descrizioni dei tool per MCP discovery

Notes:

- branch: `feature/more-complete-tool-surface`
- PR: `#13`
- merged on: `2026-03-26`

## Phase P2: Enterprise-Oriented Future

Questa fase non e' necessaria subito, ma tiene aperta la direzione giusta.

### P2.1 Security And Governance

- [x] API key interna o auth leggera per ambienti condivisi
- [x] Audit trail piu' completo per operazioni write
- [x] Policy piu' rigide su tool sensibili

Notes:

- branch: `feature/security-governance`
- PR: `#14`
- merged on: `2026-03-26`

### P2.2 Packaging And Distribution

- [x] Dockerfile minimale
- [x] release notes o changelog
- [x] versione semantica e processo di release piu' ordinato

Notes:

- branch: `feature/packaging-distribution`
- PR: `#16`
- merged on: `2026-03-26`

### P2.3 Advanced Reliability

- [x] retry/backoff mirato per Bitbucket API
- [x] metriche runtime essenziali
- [x] test di integrazione contro sandbox controllata

Notes:

- branch: `feature/advanced-reliability`

## First Development Slice

Task consigliato per iniziare:

- `P0.1 Quality Baseline`

Branch suggerito:

- `feature/quality-baseline`

Output atteso del primo ciclo:

- lint e format attivi
- script npm puliti
- CI base presente

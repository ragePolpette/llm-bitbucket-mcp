# llm-bitbucket-mcp

MCP server per Bitbucket Cloud con:

- tool semantici per pull request
- commenti PR
- clone repository confinato sotto una clone root configurata
- endpoint `bb_api` generico ma read-only (solo GET)
- logging strutturato per integrazione con `mcp-dashboard`

## Requisiti

- Node.js 22+
- credenziali Bitbucket Cloud:
  - `BITBUCKET_USER_EMAIL`
  - `BITBUCKET_API_TOKEN`

## Setup

Installa le dipendenze:

```bash
npm install
```

Copia o usa come riferimento:

- [`.env.example`](/C:/Users/Gianmarco/Urgewalt/Yetzirah/llm-bitbucket-mcp/.env.example)

Nota:

- `BITBUCKET_API_TOKEN` non deve stare nel `.env`
- il server rifiuta l'avvio se trova il token nel file `.env`
- il token va passato solo a runtime, per esempio dalla dashboard
- `MCP_BB_CLONE_ROOT` puo' definire la root autorizzata per i clone; se assente usa `_clones` sotto la root del progetto

## Avvio

```bash
npm start
```

Health:

- `http://127.0.0.1:8783/health`

MCP endpoint:

- `http://127.0.0.1:8783/mcp`

## Tool esposti

- `list_pull_requests`
- `get_pull_request`
- `get_pull_request_diff`
- `get_pull_request_comments`
- `add_pull_request_comment`
- `bb_clone`
- `bb_api`

## Note

- `create_pull_request`, `approve_pull_request` e `merge_pull_request` non fanno parte del surface MCP corrente e vengono rifiutati anche se un client prova a chiamarli direttamente
- `bb_api` supporta solo richieste GET
- `bb_clone` usa `targetPath` come percorso finale esatto del clone e lo accetta solo se resta sotto `MCP_BB_CLONE_ROOT`
- il server usa sessioni MCP streamable HTTP e logging strutturato `LLM_BB_MCP`

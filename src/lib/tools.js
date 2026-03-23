/**
 * Tool definitions exposed via MCP ListTools.
 *
 * NOTE: approve_pull_request and merge_pull_request
 * have handlers implemented but are NOT exposed here yet.
 * To enable them, add their definitions to the TOOLS array.
 */

export const TOOLS = [
    // ── PR read tools ────────────────────────────────────────────
    {
        name: "list_pull_requests",
        description: "Lista le pull request del repository Bitbucket. Filtra per stato e opzionalmente per branch sorgente.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                state: {
                    type: "string",
                    enum: ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"],
                    description: "Stato PR. Default: OPEN."
                },
                source_branch: {
                    type: "string",
                    description: "Filtra per branch sorgente (match esatto). Opzionale."
                },
                page: {
                    type: "integer",
                    minimum: 1,
                    description: "Pagina (1-based). Default: 1."
                },
                pagelen: {
                    type: "integer",
                    minimum: 1,
                    maximum: 50,
                    description: "Risultati per pagina (max 50). Default: 25."
                }
            }
        }
    },
    {
        name: "get_pull_request",
        description: "Dettaglio completo di una pull request (titolo, descrizione, autore, reviewers, stato, branch, date).",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: { type: "integer", description: "ID della Pull Request." }
            },
            required: ["pr_id"]
        }
    },
    {
        name: "get_pull_request_diff",
        description: "Diff unificato (patch) di una pull request. Troncato a 500KB se troppo grande.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: { type: "integer", description: "ID della Pull Request." }
            },
            required: ["pr_id"]
        }
    },
    {
        name: "get_pull_request_comments",
        description: "Tutti i commenti di una pull request (generali + inline). Paginazione automatica, cap 500.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: { type: "integer", description: "ID della Pull Request." }
            },
            required: ["pr_id"]
        }
    },

    // ── PR write tools ───────────────────────────────────────────
    {
        name: "add_pull_request_comment",
        description: "Posta un commento su una pull request. Generale o inline (su file/riga specifici). Supporta Markdown.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                pr_id: { type: "integer", description: "ID della Pull Request." },
                content: { type: "string", description: "Testo del commento (Markdown supportato)." },
                file_path: { type: "string", description: "Path del file per commento inline. Omettere per commento generale." },
                line_to: { type: "integer", description: "Numero riga (nel nuovo file) per commento inline." }
            },
            required: ["pr_id", "content"]
        }
    },
    {
        name: "create_pull_request",
        description: "Crea una nuova pull request su Bitbucket dal branch sorgente verso il branch di destinazione.",
        annotations: { readOnlyHint: false, idempotentHint: false },
        inputSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Titolo della PR." },
                source_branch: { type: "string", description: "Branch sorgente." },
                description: { type: "string", description: "Descrizione Markdown della PR." },
                destination_branch: {
                    type: "string",
                    description: "Branch destinazione. Default: BPOFH."
                },
                reviewers: {
                    type: "array",
                    items: { type: "string" },
                    description: "UUID Bitbucket dei reviewer."
                },
                close_source_branch: {
                    type: "boolean",
                    description: "Chiudi il branch sorgente dopo il merge. Default: true."
                }
            },
            required: ["title", "source_branch"]
        }
    },

    // ── Utility tools ────────────────────────────────────────────
    {
        name: "bb_clone",
        description: "Clona un repository Bitbucket in locale sotto la clone root configurata (SSH preferred, HTTPS fallback).",
        annotations: { readOnlyHint: false },
        inputSchema: {
            type: "object",
            properties: {
                repoSlug: {
                    type: "string",
                    description: "Repository slug (es. 'bpopilot'). Validato: solo lettere, numeri, '.', '_', '-'."
                },
                targetPath: {
                    type: "string",
                    description: "Path finale completo del clone, dentro la clone root configurata."
                },
                workspaceSlug: {
                    type: "string",
                    description: "Workspace slug. Default: workspace da configurazione."
                }
            },
            required: ["repoSlug", "targetPath"]
        }
    },
    {
        name: "bb_api",
        description: "Chiamata generica read-only all'API Bitbucket REST 2.0. Supporta solo GET per endpoint non coperti dai tool semantici.",
        annotations: { readOnlyHint: true },
        inputSchema: {
            type: "object",
            properties: {
                method: {
                    type: "string",
                    enum: ["GET"],
                    description: "Metodo HTTP consentito. Solo GET."
                },
                path: {
                    type: "string",
                    description: "API path read-only (es. '/repositories/studioboost/bpopilot/pipelines'). /2.0/ preposto automaticamente se mancante."
                },
                body: {
                    type: "object",
                    description: "Non usato. Lasciare vuoto."
                },
                queryParams: {
                    type: "object",
                    description: "Query string params (es. {\"state\": \"OPEN\"}).",
                    additionalProperties: { type: "string" }
                }
            },
            required: ["method", "path"]
        }
    }
];

/*
 * ── Tool definitions ready but NOT exposed ─────────────────────
 * Uncomment and add to TOOLS array to enable:
 *
 * {
 *     name: "approve_pull_request",
 *     description: "Approva una pull request (come utente autenticato).",
 *     annotations: { readOnlyHint: false, idempotentHint: true },
 *     inputSchema: {
 *         type: "object",
 *         properties: { pr_id: { type: "integer", description: "ID della Pull Request." } },
 *         required: ["pr_id"]
 *     }
 * },
 * {
 *     name: "merge_pull_request",
 *     description: "Merge di una pull request. Operazione irreversibile.",
 *     annotations: { readOnlyHint: false, destructiveHint: true },
 *     inputSchema: {
 *         type: "object",
 *         properties: {
 *             pr_id: { type: "integer", description: "ID della Pull Request." },
 *             merge_strategy: { type: "string", enum: ["merge_commit","squash","fast_forward"], description: "Strategia merge. Default: merge_commit." },
 *             close_source_branch: { type: "boolean", description: "Chiudi branch. Default: true." },
 *             message: { type: "string", description: "Messaggio commit merge. Opzionale." }
 *         },
 *         required: ["pr_id"]
 *     }
 * }
 */

export const EXPOSED_TOOL_NAMES = new Set(TOOLS.map(tool => tool.name));

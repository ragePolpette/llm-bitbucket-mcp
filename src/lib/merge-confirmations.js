import { randomBytes, createHash } from "node:crypto";
import { safeEqualSecret } from "./runtime-policy.js";
import { MERGE_CONFIRMATION_TTL_MS } from "./tool-policy.js";

export class ConfirmationStoreCapacityError extends Error {
    constructor(maxPending) {
        super(
            `Too many pending confirmations (maximum ${maxPending}). Wait for existing tokens to expire and retry.`,
        );
        this.name = "ConfirmationStoreCapacityError";
        this.status = 503;
    }
}

function fingerprint(scope) {
    return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

export function createConfirmationStore({
    ttlMs = MERGE_CONFIRMATION_TTL_MS,
    now = () => Date.now(),
    maxPending = 1000,
    maxPendingPerOwner = 10,
} = {}) {
    const pending = new Map();

    function purgeExpired() {
        const current = now();
        for (const [token, entry] of pending) {
            if (entry.expiresAt <= current) {
                pending.delete(token);
            }
        }
    }

    function tokensOwnedBy(owner) {
        const tokens = [];
        for (const [token, entry] of pending) {
            if (entry.owner === owner) {
                tokens.push(token);
            }
        }
        return tokens;
    }

    return {
        issue(scope, { owner = "" } = {}) {
            purgeExpired();
            const ownerKey = String(owner || "");
            const ownTokens = tokensOwnedBy(ownerKey);
            if (ownTokens.length >= maxPendingPerOwner) {
                pending.delete(ownTokens[0]);
            } else if (pending.size >= maxPending) {
                throw new ConfirmationStoreCapacityError(maxPending);
            }
            const token = randomBytes(24).toString("base64url");
            const expiresAt = now() + ttlMs;
            pending.set(token, { scopeHash: fingerprint(scope), owner: ownerKey, expiresAt });
            return { token, expiresAt, ttlMs };
        },

        consume(token, scope, { owner = "" } = {}) {
            purgeExpired();
            const providedToken = String(token || "").trim();
            if (!providedToken) {
                return { ok: false, reason: "missing" };
            }
            let matchedToken = null;
            for (const storedToken of pending.keys()) {
                if (safeEqualSecret(storedToken, providedToken)) {
                    matchedToken = storedToken;
                    break;
                }
            }
            const entry = matchedToken ? pending.get(matchedToken) : null;
            if (!entry || entry.owner !== String(owner || "")) {
                return { ok: false, reason: "unknown_or_expired" };
            }
            pending.delete(matchedToken);
            if (!safeEqualSecret(entry.scopeHash, fingerprint(scope))) {
                return { ok: false, reason: "scope_mismatch" };
            }
            return { ok: true };
        },

        size() {
            purgeExpired();
            return pending.size;
        },

        clear() {
            pending.clear();
        },
    };
}

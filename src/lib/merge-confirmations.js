import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { MERGE_CONFIRMATION_TTL_MS } from "./tool-policy.js";

function fingerprint(scope) {
    return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

function secureEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ""), "utf8");
    const rightBuffer = Buffer.from(String(right || ""), "utf8");
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createConfirmationStore({
    ttlMs = MERGE_CONFIRMATION_TTL_MS,
    now = () => Date.now(),
    maxPending = 100,
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

    return {
        issue(scope) {
            purgeExpired();
            if (pending.size >= maxPending) {
                const oldestToken = pending.keys().next().value;
                pending.delete(oldestToken);
            }
            const token = randomBytes(24).toString("base64url");
            const expiresAt = now() + ttlMs;
            pending.set(token, { scopeHash: fingerprint(scope), expiresAt });
            return { token, expiresAt, ttlMs };
        },

        consume(token, scope) {
            purgeExpired();
            const providedToken = String(token || "").trim();
            if (!providedToken) {
                return { ok: false, reason: "missing" };
            }
            let matchedToken = null;
            for (const storedToken of pending.keys()) {
                if (secureEqual(storedToken, providedToken)) {
                    matchedToken = storedToken;
                    break;
                }
            }
            if (!matchedToken) {
                return { ok: false, reason: "unknown_or_expired" };
            }
            const entry = pending.get(matchedToken);
            pending.delete(matchedToken);
            if (!secureEqual(entry.scopeHash, fingerprint(scope))) {
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

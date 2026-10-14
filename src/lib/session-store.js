import { DEFAULT_MAX_SESSIONS, DEFAULT_SESSION_TTL_MS } from "./runtime-policy.js";

export class SessionStoreCapacityError extends Error {
    constructor(maxSessions) {
        super(`Session limit reached: at most ${maxSessions} active sessions.`);
        this.name = "SessionStoreCapacityError";
        this.status = 503;
    }
}

export function createSessionStore({
    ttlMs = DEFAULT_SESSION_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
} = {}) {
    const sessions = new Map();
    let reserved = 0;
    const ttlEnabled = Number(ttlMs) > 0;
    const capacity = Number(maxSessions) > 0 ? Number(maxSessions) : 100;

    function prune(now = Date.now()) {
        if (!ttlEnabled) {
            return;
        }
        for (const [sessionId, entry] of sessions.entries()) {
            if (entry.expiresAt <= now) {
                sessions.delete(sessionId);
            }
        }
    }

    function store(sessionId, transport, now) {
        sessions.set(sessionId, {
            transport,
            expiresAt: ttlEnabled ? now + ttlMs : Number.POSITIVE_INFINITY,
        });
    }

    function set(sessionId, transport, now = Date.now()) {
        prune(now);
        if (!sessions.has(sessionId) && sessions.size + reserved >= capacity) {
            throw new SessionStoreCapacityError(capacity);
        }
        store(sessionId, transport, now);
    }

    function reserve(now = Date.now()) {
        prune(now);
        if (sessions.size + reserved >= capacity) {
            throw new SessionStoreCapacityError(capacity);
        }
        reserved += 1;
        let active = true;
        const release = () => {
            if (active) {
                active = false;
                reserved -= 1;
            }
        };
        return {
            commit(sessionId, transport, commitNow = Date.now()) {
                if (!active) {
                    throw new Error("Session reservation already used or released.");
                }
                release();
                store(sessionId, transport, commitNow);
            },
            release,
        };
    }

    function get(sessionId, now = Date.now()) {
        prune(now);
        const entry = sessions.get(sessionId);
        if (!entry) {
            return null;
        }
        if (ttlEnabled) {
            entry.expiresAt = now + ttlMs;
        }
        return entry.transport;
    }

    function deleteSession(sessionId) {
        sessions.delete(sessionId);
    }

    return {
        set,
        reserve,
        get,
        delete: deleteSession,
        prune,
        size(now = Date.now()) {
            prune(now);
            return sessions.size;
        },
        maxSessions() {
            return capacity;
        },
    };
}

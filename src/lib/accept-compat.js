import { normalizeHeaderValue } from "./runtime-policy.js";

export function applyJsonAcceptCompatibility(headers, { sseEnabled }) {
    if (sseEnabled) {
        return false;
    }

    const accept = normalizeHeaderValue(headers?.accept);
    if (!accept) {
        return false;
    }

    const lowered = accept.toLowerCase();
    if (!lowered.includes("application/json")) {
        return false;
    }
    if (lowered.includes("text/event-stream")) {
        return false;
    }

    headers.accept = `${accept}, text/event-stream`;
    return true;
}

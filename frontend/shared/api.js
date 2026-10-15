import { session } from './state.js';

export const API_BASE_URL = (window.GIGTASK_CONFIG?.apiBaseUrl || "/api").replace(/\/$/, "");

export async function api(path, options = {}) {
    const context = session.actor;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(API_BASE_URL + "/" + path, {
            ...options,
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                ...(context
                    ? {
                          "X-Demo-Role": context.role,
                          ...(context.id
                              ? { "X-Demo-Id": String(context.id) }
                              : {}),
                      }
                    : {}),
                ...options.headers,
            },
        });
        let result;
        try {
            result = await response.json();
        } catch {
            // A proxy or gateway error page is HTML, not JSON.
            const error = new Error(
                response.ok
                    ? "The server sent a response that could not be read. Retry shortly."
                    : `The service is not responding correctly (HTTP ${response.status}). Retry shortly.`,
            );
            error.status = response.status;
            throw error;
        }
        if (!response.ok) {
            const error = new Error(result.error || "Request failed.");
            error.status = response.status;
            throw error;
        }
        return result;
    } catch (error) {
        if (error.name === "AbortError")
            throw new Error(
                options.method
                    ? "Request timed out. Check your contracts before retrying; the action may have completed."
                    : "The server took too long to respond. Retry when it is available.",
            );
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

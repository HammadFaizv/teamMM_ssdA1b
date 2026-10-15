import { publicNames } from './editorial.js';
import { render } from './render.js';
import { session } from './state.js';

export function allowed(page) {
    if (!session.actor) return false;
    if (page === "fund") return session.actor.role === "client";
    if (["audit", "nearby", "client"].includes(page))
        return session.actor.role !== "freelancer";
    return true;
}

export function route() {
    const [name, query = ""] = (location.hash.slice(1) || "browse").split("?");
    return {
        name: Object.hasOwn(publicNames, name) ? name : "browse",
        q: new URLSearchParams(query),
    };
}

export function go(hash) {
    if (location.hash === "#" + hash) render();
    else location.hash = hash;
}

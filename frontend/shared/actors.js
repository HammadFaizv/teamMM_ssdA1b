import { $, esc, notice } from './ui.js';
import { api } from './api.js';
import { saveStorage } from './storage.js';
import { persist, session } from './state.js';
import { allowed, go, route } from './router.js';
import { render } from './render.js';

export async function loadActors() {
    const ticket = ++session.actorGeneration;
    const role = $("#actor-role").value;
    $("#actor-continue").disabled = true;
    $("#actor-error").textContent = "";
    $("#actor-pages").innerHTML = "";
    $("#actor-id").innerHTML = "";
    $("#actor-picker").hidden = role === "admin" || !role;
    $("#actor-id").required = Boolean(role) && role !== "admin";
    $("#actor-id").disabled = !role || role === "admin";
    if (role === "admin") {
        $("#actor-continue").disabled = false;
        return;
    }
    if (!role) return;
    $("#actor-error").textContent = "Loading demo actors…";
    try {
        const r = await api(
            `actors?role=${role}&page=${session.actorPage}&limit=10&search=${encodeURIComponent($("#actor-search").value)}`,
        );
        if (ticket !== session.actorGeneration) return;
        $("#actor-id").innerHTML =
            '<option value="">Choose a demo ' +
            role +
            "</option>" +
            r.data
                .map(
                    (r) =>
                        `<option value="${r.id}">${esc(r.name)} #${r.id}</option>`,
                )
                .join("");
        $("#actor-error").textContent = r.total
            ? ""
            : "No demo actors match. Change the search or retry.";
        session.actorTotalPages = r.totalPages;
        $("#actor-pages").innerHTML =
            `<button type="button" data-actor-page="-1" ${session.actorPage <= 1 ? "disabled" : ""}>Previous</button><span>Page ${session.actorPage} of ${r.totalPages || 1}</span><button type="button" data-actor-page="1" ${session.actorPage >= r.totalPages ? "disabled" : ""}>Next</button>`;
    } catch (e) {
        if (ticket === session.actorGeneration)
            $("#actor-error").textContent = e.message;
    }
}

export function openActor() {
    if (session.pending) return;
    $("#actor-role").value = session.actor?.role || "";
    $("#actor-search").value = "";
    session.actorPage = 1;
    $("#close-actor").hidden = !session.actor;
    $("#actor-dialog").showModal();
    loadActors();
}

export function initActorEvents() {
    $("#actor-switch").onclick = openActor;
    $("#close-actor").onclick = () => $("#actor-dialog").close();
    $("#actor-dialog").addEventListener("cancel", (e) => {
        if (!session.actor) e.preventDefault();
    });
    $("#actor-role").onchange = () => {
        session.actorPage = 1;
        $("#actor-search").value = "";
        loadActors();
    };
    $("#actor-search-button").onclick = () => {
        session.actorPage = 1;
        loadActors();
    };
    $("#actor-search").onkeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            session.actorPage = 1;
            loadActors();
        }
    };
    $("#actor-id").onchange = () =>
        ($("#actor-continue").disabled = !$("#actor-id").value);
    $("#actor-retry").onclick = loadActors;
    $("#actor-pages").onclick = (e) => {
        const b = e.target.closest("[data-actor-page]");
        if (b && !b.disabled) {
            session.actorPage += Number(b.dataset.actorPage);
            loadActors();
        }
    };
    $("#actor-form").onsubmit = (e) => {
        e.preventDefault();
        const role = $("#actor-role").value,
            id = Number($("#actor-id").value);
        if (!role || (role !== "admin" && !id)) return;
        if (
            session.dirty &&
            !confirm(
                "Switch actor and discard these changes? Choose Cancel to stay.",
            )
        )
            return;
        const previous = session.actor;
        session.actor = {
            role,
            id: role === "admin" ? null : id,
            name:
                role === "admin"
                    ? "Admin"
                    : $("#actor-id").selectedOptions[0].text.replace(/ #\d+$/, ""),
        };
        saveStorage("gigtask.actor", session.actor);
        session.pages = {};
        persist();
        session.draft = null;
        session.dirty = false;
        notice("");
        $("#actor-dialog").close();
        if (previous) go("browse");
        else if (allowed(route().name)) render();
        else go("browse");
    };
}


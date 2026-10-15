import { $, esc, money } from './ui.js';
import { publicNames } from './editorial.js';
import { saveStorage } from './storage.js';
import { api } from './api.js';
import { session } from './state.js';

export function header() {
    $("#actor-switch").textContent = session.actor
        ? `${session.actor.role === "admin" ? "Admin · read only" : `${session.actor.role === "client" ? "Client" : "Freelancer"} · ${session.actor.name} #${session.actor.id}`} ▾`
        : "Choose demo actor";
    $("#fact-actor").textContent = session.actor
        ? session.actor.role === "admin"
            ? "Platform admin"
            : `${session.actor.name || "Actor"} #${session.actor.id}`
        : "Not chosen";
    $("#fact-role").textContent = session.actor
        ? { client: "Client", freelancer: "Freelancer", admin: "Admin · read only" }[session.actor.role]
        : "—";
    const pages = [
        "browse",
        ...(session.actor?.role === "client" ? ["fund"] : []),
        ...(session.actor?.role !== "freelancer" ? ["audit"] : []),
        "analytics",
        ...(session.actor?.role !== "freelancer" ? ["nearby"] : []),
        "reviews",
    ];
    $("#navigation").innerHTML = session.actor
        ? pages
              .map(
                  (p) =>
                      `<a href="#${p}" class="${session.currentRoute?.name === p ? "active" : ""}">${esc(publicNames[p])}</a>`,
              )
              .join("")
        : "";
}

export async function stats(ticket) {
    try {
        const r = await api("overview");
        if (ticket !== session.generation) return;
        if (session.actor.role !== 'admin') {
            const current=await api(`${session.actor.role==='client'?'clients':'freelancers'}/${session.actor.id}`);
            if(ticket!==session.generation)return;
            if(session.actor.name!==current.data.name){session.actor.name=current.data.name;saveStorage('gigtask.actor',session.actor);header();}
        }
        const entries = Object.entries(r).filter(([k]) => k !== "mode");
        $("#stats").innerHTML = entries
            .map(
                ([key, value]) =>
                    `<div class="stat"><small>${esc(key === "balance" ? "Available demo balance" : key)}</small><strong>${key === "balance" ? money(value) : value}</strong><span class="hint">${session.actor.role === "admin" ? "Platform overview" : "Current actor context"}</span></div>`,
            )
            .join("");
    } catch (error) {
        if (ticket === session.generation)
            $("#stats").innerHTML =
                `<p class="error">Summary unavailable: ${esc(error.message)} <button class="secondary" data-retry>Retry</button></p>`;
    }
}

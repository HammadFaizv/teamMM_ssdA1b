import { EMPTY_QUOTES, pick } from './editorial.js';
import { pageState } from './state.js';

export const $ = (selector) => document.querySelector(selector);

export const esc = (value) =>
    String(value ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );

export const money = (n) =>
    new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
    }).format(n);

export const date = (value) => new Date(value).toLocaleString();

export function link(hash, text, cls = "detail-btn") {
    return `<a class="${cls}" href="#${esc(hash)}">${esc(text)}</a>`;
}

export function badge(status) {
    return `<span class="badge ${["Busy", "FUNDED", "IN_PROGRESS"].includes(status) ? "busy" : ""}">${esc(status.replaceAll("_", " "))}</span>`;
}

export function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function person(r) {
    return `<span class="person"><span class="avatar">${esc(
        r.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join(""),
    )}</span>${esc(r.name)}</span>`;
}

export function empty(text, next = "") {
    return `<div class="message">${esc(text)}${next ? `<p>${next}</p>` : ""}<span class="quote">${esc(pick(EMPTY_QUOTES, text))}</span></div>`;
}

export function errorView(error) {
    return `<div class="message error">${esc(error.message)}<div class="actions"><button class="secondary" data-retry>Retry</button>${link("browse", "Go to Browse")}</div><span class="quote">Even great gigs hit a snag. Retry and carry on.</span></div>`;
}

export function notice(text, error = false) {
    $("#notice").innerHTML = text
        ? `<div class="notice ${error ? "error" : ""}">${esc(text)}</div>`
        : "";
}

export function filters(html, name) {
    $("#filters").innerHTML = html;
    const values = pageState(name).filters;
    for (const [key, value] of Object.entries(values)) {
        const field = $("#filters").elements.namedItem(key);
        if (field) field.value = value;
    }
}

export function pagination(result, name) {
    $("#pagination").innerHTML =
        `<span>${result.total} records · Page ${result.page} of ${result.totalPages || 1}</span><div><button data-page="-1" ${result.page <= 1 ? "disabled" : ""}>← Previous</button><button data-page="1" ${result.page >= result.totalPages ? "disabled" : ""}>Next →</button></div>`;
    $("#pagination").dataset.state = name;
}

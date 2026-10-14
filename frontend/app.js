const API_BASE_URL = (window.GIGTASK_CONFIG?.apiBaseUrl || "/api").replace(/\/$/, "");
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
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
const money = (n) =>
    new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
    }).format(n);
const date = (value) => new Date(value).toLocaleString();
const readStorage = (key, fallback) => {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
};
const saveStorage = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* Demo remains usable when storage is disabled. */
    }
};
let actor = readStorage("gigtask.actor", null);
if (
    actor &&
    (!["client", "freelancer", "admin"].includes(actor.role) ||
        (actor.role !== "admin" && !Number.isInteger(actor.id)))
)
    actor = null;
let state = readStorage("gigtask.pages", {}),
    generation = 0,
    pending = false,
    dirty = false,
    poll = null,
    currentRoute = null,
    draft = null;
let actorPage = 1,
    actorGeneration = 0,
    actorTotalPages = 1;
const publicNames = {
    browse: "Browse",
    fund: "Fund a gig",
    audit: "Escrow audit",
    analytics: "Freelancer analytics",
    nearby: "Nearby workers",
    reviews: "Reviews & portfolios",
    contract: "Contract details",
    worker: "Worker details",
    client: "Client details",
};
// Copy for the editorial header of each page. Static strings written here, never user data, so they are inserted as HTML.
const hl = (text) => `<span class="hl"><b><i>${text}</i></b></span>`;
const QUOTES = {
    welcome: {
        tagline: "GigTask is a marketplace built around one simple idea: find the work, fund it fairly, and finish it with confidence.",
        statement: `Great work is not found by accident. It starts when <b><i>the right person meets a clear brief</i></b>. GigTask is where talent, budgets and trust meet, so every task can become ${hl("a gig worth finishing")}`,
        closing: `Find the work. Do the work. ${hl("Get paid for the work.")}`,
    },
    browse: {
        tagline: "Every contract, client and freelancer in one calm place, searchable and paged so you only see what you need.",
        statement: `Great work is not created by accident. It is built through <b><i>the right match, a clear brief and a fair budget</i></b>. GigTask keeps every ${hl("contract, client and freelancer")} in one place, so the next good gig is only a search away.`,
        closing: `Small tasks. ${hl("Big momentum.")}`,
    },
    fund: {
        tagline: "Reserve the budget, start the work. The money is held, the contract is created and the ledger is written in one step.",
        statement: `A gig is a promise with a budget attached. Fund it once and <b><i>the money is held, the work can begin, and every step is written down</i></b>. That is how ${hl("trust")} becomes a habit.`,
        closing: `Fund the work. ${hl("Free the talent.")}`,
    },
    audit: {
        tagline: "A read-only ledger of every hold and release, in order, with the balance after each change.",
        statement: `Trust is just a ledger that never lies. Every hold and release is recorded once and <b><i>never edited afterwards</i></b>. Read it like a story in which ${hl("every rupee has a reason")}`,
        closing: `Clear books. ${hl("Clear minds.")}`,
    },
    analytics: {
        tagline: "Seven-day revenue averages, ranks and lifetime earnings: the pulse of every freelancer on the platform.",
        statement: `Momentum is measured one finished task at a time. Watch the seven-day average rise, follow the rank, and see ${hl("who is quietly doing the best work")} <b><i>this week</i></b>.`,
        closing: `Finish well. ${hl("Rank higher.")}`,
    },
    nearby: {
        tagline: "Drop a pin and meet the available freelancers within five kilometres, nearest first.",
        statement: `The right talent is closer than you think. Choose a job site, look <b><i>five kilometres in every direction</i></b>, and meet ${hl("the people ready to work today")}`,
        closing: `Work is local. ${hl("Talent is near.")}`,
    },
    reviews: {
        tagline: "Ratings, skill tags and portfolios: the honest record of work that was done well.",
        statement: `Reputation is built gig by gig. Ratings, tags and portfolios tell the story of <b><i>work that was done well</i></b>, long after ${hl("the invoice is forgotten")}`,
        closing: `Good work ${hl("speaks first.")}`,
    },
    contract: {
        tagline: "One contract, from funded budget to finished work.",
        statement: `Every contract begins as a handshake and ends as a result. Between the two sit <b><i>a budget, a freelancer and a status that only moves forward</i></b>. Keep it moving, and ${hl("the work keeps its promise")}`,
        closing: `Promises kept. ${hl("Gigs delivered.")}`,
    },
    worker: {
        tagline: "A freelancer's profile, portfolio and track record.",
        statement: `Behind every profile is <b><i>a craft, a record and a reason to be hired</i></b>. Read the portfolio, check the reviews, and ${hl("fund the work you believe in")}`,
        closing: `Skill is the best ${hl("introduction.")}`,
    },
    client: {
        tagline: "A client's balance and history in one place.",
        statement: `Good clients make good work possible. A <b><i>clear brief, a fair budget and a balance you can trust</i></b> are how ${hl("great gigs begin")}`,
        closing: `Fair budgets. ${hl("Great gigs.")}`,
    },
};
const EMPTY_QUOTES = [
    "Every big gig starts with an empty page.",
    "No work here yet. That is room for the next one.",
    "A quiet list is just a gig waiting to be funded.",
    "Even the longest task list started with nothing.",
    "Nothing to show yet. Good work takes a moment.",
];
const LOADING_QUOTES = [
    "Good work takes a moment.",
    "Great gigs are worth the wait.",
    "Gathering the work, one task at a time.",
];
const pick = (list, text) =>
    list[[...String(text)].reduce((n, c) => n + c.charCodeAt(0), 0) % list.length];
function editorial(name) {
    const q = QUOTES[name] || QUOTES.welcome;
    $("#statement").innerHTML = q.statement;
    $("#closing").innerHTML = q.closing;
    $("#subtitle").textContent = q.tagline;
    $("#fact-scope").textContent = name === "welcome" ? "Welcome" : publicNames[name];
    $("#fact-year").textContent = String(new Date().getFullYear());
}
function pageState(name) {
    return (state[name] ||= { page: 1, filters: {} });
}
function persist() {
    saveStorage("gigtask.pages", state);
}
function link(hash, text, cls = "detail-btn") {
    return `<a class="${cls}" href="#${esc(hash)}">${esc(text)}</a>`;
}
function badge(status) {
    return `<span class="badge ${["Busy", "FUNDED", "IN_PROGRESS"].includes(status) ? "busy" : ""}">${esc(status.replaceAll("_", " "))}</span>`;
}
function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function person(r) {
    return `<span class="person"><span class="avatar">${esc(
        r.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join(""),
    )}</span>${esc(r.name)}</span>`;
}
function empty(text, next = "") {
    return `<div class="message">${esc(text)}${next ? `<p>${next}</p>` : ""}<span class="quote">${esc(pick(EMPTY_QUOTES, text))}</span></div>`;
}
function errorView(error) {
    return `<div class="message error">${esc(error.message)}<div class="actions"><button class="secondary" data-retry>Retry</button>${link("browse", "Go to Browse")}</div><span class="quote">Even great gigs hit a snag. Retry and carry on.</span></div>`;
}
function notice(text, error = false) {
    $("#notice").innerHTML = text
        ? `<div class="notice ${error ? "error" : ""}">${esc(text)}</div>`
        : "";
}
function allowed(page) {
    if (!actor) return false;
    if (page === "fund") return actor.role === "client";
    if (["audit", "nearby", "client"].includes(page))
        return actor.role !== "freelancer";
    return true;
}
function route() {
    const [name, query = ""] = (location.hash.slice(1) || "browse").split("?");
    return {
        name: Object.hasOwn(publicNames, name) ? name : "browse",
        q: new URLSearchParams(query),
    };
}
function go(hash) {
    if (location.hash === "#" + hash) render();
    else location.hash = hash;
}
async function api(path, options = {}) {
    const context = actor;
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
function header() {
    $("#actor-switch").textContent = actor
        ? `${actor.role === "admin" ? "Admin · read only" : `${actor.role === "client" ? "Client" : "Freelancer"} · ${actor.name} #${actor.id}`} ▾`
        : "Choose demo actor";
    $("#fact-actor").textContent = actor
        ? actor.role === "admin"
            ? "Platform admin"
            : `${actor.name || "Actor"} #${actor.id}`
        : "Not chosen";
    $("#fact-role").textContent = actor
        ? { client: "Client", freelancer: "Freelancer", admin: "Admin · read only" }[actor.role]
        : "—";
    const pages = [
        "browse",
        ...(actor?.role === "client" ? ["fund"] : []),
        ...(actor?.role !== "freelancer" ? ["audit"] : []),
        "analytics",
        ...(actor?.role !== "freelancer" ? ["nearby"] : []),
        "reviews",
    ];
    $("#navigation").innerHTML = actor
        ? pages
              .map(
                  (p) =>
                      `<a href="#${p}" class="${currentRoute?.name === p ? "active" : ""}">${esc(publicNames[p])}</a>`,
              )
              .join("")
        : "";
}
function filters(html, name) {
    $("#filters").innerHTML = html;
    const values = pageState(name).filters;
    for (const [key, value] of Object.entries(values)) {
        const field = $("#filters").elements.namedItem(key);
        if (field) field.value = value;
    }
}
function pagination(result, name) {
    $("#pagination").innerHTML =
        `<span>${result.total} records · Page ${result.page} of ${result.totalPages || 1}</span><div><button data-page="-1" ${result.page <= 1 ? "disabled" : ""}>← Previous</button><button data-page="1" ${result.page >= result.totalPages ? "disabled" : ""}>Next →</button></div>`;
    $("#pagination").dataset.state = name;
}
async function stats(ticket) {
    try {
        const r = await api("overview");
        if (ticket !== generation) return;
        if (actor.role !== 'admin') {
            const current=await api(`${actor.role==='client'?'clients':'freelancers'}/${actor.id}`);
            if(ticket!==generation)return;
            if(actor.name!==current.data.name){actor.name=current.data.name;saveStorage('gigtask.actor',actor);header();}
        }
        const entries = Object.entries(r).filter(([k]) => k !== "mode");
        $("#stats").innerHTML = entries
            .map(
                ([key, value]) =>
                    `<div class="stat"><small>${esc(key === "balance" ? "Available demo balance" : key)}</small><strong>${key === "balance" ? money(value) : value}</strong><span class="hint">${actor.role === "admin" ? "Platform overview" : "Current actor context"}</span></div>`,
            )
            .join("");
    } catch (error) {
        if (ticket === generation)
            $("#stats").innerHTML =
                `<p class="error">Summary unavailable: ${esc(error.message)} <button class="secondary" data-retry>Retry</button></p>`;
    }
}
function browseEntity() {
    const requested = currentRoute.q.get("tab") || pageState("browse").tab;
    const choices =
        actor.role === "admin"
            ? ["clients", "freelancers", "contracts"]
            : actor.role === "client"
              ? ["contracts", "freelancers"]
              : ["contracts", "freelancers"];
    return choices.includes(requested) ? requested : choices[0];
}
async function browse(ticket) {
    const entity = browseEntity();
    pageState("browse").tab = entity;
    persist();
    const tabs =
        actor.role === "admin"
            ? ["clients", "freelancers", "contracts"]
            : ["contracts", "freelancers"];
    $("#tabs").innerHTML = tabs
        .map((t) =>
            link(
                `browse?tab=${t}`,
                actor.role === "admin"
                    ? t
                    : t === "contracts"
                      ? "My contracts"
                      : actor.role === "freelancer"
                        ? "My profile"
                        : "Freelancers",
                `tab ${t === entity ? "selected" : ""}`,
            ),
        )
        .join("");
    const key = "browse-" + entity,
        s = pageState(key);
    filters(
        `<input name="search" type="search" aria-label="${actor.role === "admin" ? "Search by name or ID" : "Search by freelancer name"}" placeholder="${actor.role === "admin" ? "Search by name or ID" : "Search by freelancer name"}…">${entity === "contracts" ? '<select name="status" aria-label="Status"><option value="">All statuses</option><option>FUNDED</option><option>IN_PROGRESS</option><option>COMPLETED</option></select>' : ""}<button>Search</button>`,
        key,
    );
    const q = new URLSearchParams({ ...s.filters, page: s.page, limit: 10 });
    if (currentRoute.q.get("clientId"))
        q.set("clientId", currentRoute.q.get("clientId"));
    const r = await api(`${entity}?${q}`);
    if (ticket !== generation) return;
    if (!r.data.length)
        $("#content").innerHTML = empty(
            "No records match this view.",
            actor.role === "client" && entity === "contracts"
                ? link("browse?tab=freelancers", "Discover a freelancer")
                : "Try changing the filters.",
        );
    else if (entity === "clients")
        $("#content").innerHTML = table(
            ["Client", "Balance", "Joined", ""],
            r.data.map((c) => [
                person(c),
                money(c.escrow_balance),
                date(c.created_at),
                link(`client?id=${c.id}`, "View client"),
            ]),
        );
    else if (entity === "freelancers")
        $("#content").innerHTML = `<div class="talent-grid">${r.data.map((f,index)=>`<article class="talent-card"><div class="talent-cover cover-${index%4}"><span class="talent-symbol" aria-hidden="true">${['✦','✧','✺','✹'][index%4]}</span>${badge(f.is_available?'Available':'Busy')}</div><div class="talent-body">${person(f)}<p>${esc(f.skill)}</p>${link(`worker?id=${f.id}&from=${encodeURIComponent(location.hash.slice(1))}`,'Explore profile ↗','primary')}</div></article>`).join('')}</div>`;
    else
        $("#content").innerHTML = table(
            [
                "Contract",
                "Client",
                "Freelancer",
                "Budget",
                "Status",
                "Created",
                "",
            ],
            r.data.map((c) => [
                "#" + c.id,
                esc(c.client_name || actor.name),
                link(`worker?id=${c.freelancer_id}`, c.freelancer_name || "Freelancer"),
                money(c.budget),
                badge(c.status),
                date(c.created_at),
                link(
                    `contract?id=${c.id}&from=${encodeURIComponent(location.hash.slice(1))}`,
                    "View contract",
                ),
            ]),
        );
    pagination(r, key);
}
function back(fallback) {
    const from = currentRoute.q.get("from");
    return link(
        from && /^(browse|nearby)(\?|$)/.test(from) ? from : fallback,
        "← Back",
    );
}
async function workerDetails(ticket) {
    const id = currentRoute.q.get("id");
    const [f, p, r] = await Promise.all([
        api(`freelancers/${id}`),
        api(`freelancers/${id}/portfolio`),
        api(`reviews/analytics?freelancerId=${id}`),
    ]);
    if (ticket !== generation) return;
    $("#content").innerHTML =
        `<div class="detail-page">${back("browse?tab=freelancers")}<div class="detail-hero"><div><h2>${esc(f.data.name)}</h2><p>Freelancer #${f.data.id} · ${esc(f.data.skill)}</p></div>${badge(f.data.is_available ? "Available" : "Busy")}</div>${portfolio(p.data)}<div class="actions">${link(`reviews?freelancerId=${id}`, "Read reviews")}${link(`analytics?freelancerId=${id}`, "View analytics")}${actor.role === "client" ? (f.data.is_available ? link(`fund?freelancerId=${id}`, "Fund gig with this worker", "primary") : '<span class="muted">Worker unavailable — funding disabled.</span>') : ""}</div><p>${r.total_reviews ? `${r.average_rating.toFixed(1)} / 5 · ${r.total_reviews} reviews` : "No reviews yet."}</p></div>`;
}
function portfolio(p) {
    return p
        ? `<section class="card"><h3>Portfolio</h3><p>${p.skills.map(esc).join(" · ") || "No skills added."}</p><h3>Certifications</h3>${p.certifications.length ? p.certifications.map((c) => `<p>${esc(c.name)} · ${esc(c.issuer || "")} ${esc(c.year || "")}</p>`).join("") : "<p>No certifications added.</p>"}<h3>Projects</h3>${(p.projects || []).map((p) => `<p><strong>${esc(p.title)}</strong><br>${esc(p.description)}</p>`).join("") || "<p>No projects added.</p>"}</section>`
        : "<p>No portfolio added yet.</p>";
}
async function contractDetails(ticket) {
    const id = currentRoute.q.get("id");
    const { data: c } = await api(`contracts/${id}`);
    if (ticket !== generation) return;
    const action =
        actor.role !== "admin"
            ? {
                  FUNDED: ["Start work", "IN_PROGRESS"],
                  IN_PROGRESS: ["Mark completed", "COMPLETED"],
              }[c.status]
            : null;
    $("#content").innerHTML =
        `<div class="detail-page">${back("browse?tab=contracts")}<div class="detail-hero"><h2>Contract #${c.id}</h2>${badge(c.status)}</div><dl><dt>Client</dt><dd>#${c.client_id}</dd><dt>Freelancer</dt><dd>${link(`worker?id=${c.freelancer_id}`, "Freelancer #" + c.freelancer_id)}</dd><dt>Reserved budget</dt><dd>${money(c.budget)}</dd><dt>Created</dt><dd>${esc(date(c.created_at))}</dd></dl><div id="action-error" role="alert"></div><div class="actions">${action ? `<button class="primary" id="status-action" data-id="${c.id}" data-status="${action[1]}">${action[0]}</button>` : `<p>${c.status === "COMPLETED" ? "Completed contract. No further actions." : "Admin is read only."}</p>`}${actor.role === "client" ? link("audit", "View my audit trail") : ""}</div><p>Completion records revenue for analytics; it does not pay out a freelancer wallet.</p></div>`;
}
async function clientDetails(ticket) {
    const id = currentRoute.q.get("id"),
        r = await api(`clients/${id}`);
    if (ticket !== generation) return;
    $("#content").innerHTML =
        `<div class="detail-page">${back("browse?tab=clients")}<h2>${esc(r.data.name)}</h2><p>Available demo balance: ${money(r.data.escrow_balance)}</p><div class="actions">${link(`browse?tab=contracts&clientId=${id}`, "View contracts")}${link(`audit?clientId=${id}`, "View audit history")}</div></div>`;
}
async function fund(ticket) {
    if (!draft || draft.actorId !== actor.id) {
        draft = {
            actorId: actor.id,
            freelancerId: currentRoute.q.get("freelancerId") || "",
            budget: "",
            key: crypto.randomUUID(),
        };
    }
    const c = await api(`clients/${actor.id}`);
    let selected = null;
    if (draft.freelancerId)
        selected = (await api(`freelancers/${draft.freelancerId}`)).data;
    if (ticket !== generation) return;
    $("#content").innerHTML =
        `<div class="detail-page"><p>Funding deducts the selected amount from your seeded balance and reserves it in a FUNDED contract. No external payment is made.</p><form id="fund-form"><div class="cards"><div class="card"><h3>1. Choose worker</h3><label>Find a freelancer<input id="fund-search" type="search" placeholder="Search freelancer names"></label><button id="fund-search-button" type="button" class="secondary">Search workers</button><label>Selected freelancer<select id="fund-worker" name="freelancerId" required><option value="">Choose a freelancer</option>${selected ? `<option selected value="${selected.id}">${esc(selected.name)}${selected.is_available ? "" : " · unavailable"}</option>` : ""}</select></label><p id="worker-load" role="status"></p><div id="worker-pages" class="pagination"></div></div><div class="card"><h3>2. Budget & review</h3><p>Client: ${esc(actor.name)} #${actor.id}<br>Available balance: <strong>${money(c.data.escrow_balance)}</strong></p><label>Budget (INR)<input name="budget" id="fund-budget" type="text" inputmode="decimal" required pattern="(?:0|[1-9][0-9]{0,6})(?:\\.[0-9]{1,2})?" value="${esc(draft.budget)}" placeholder="500.00"></label><p id="fund-preview"></p></div></div><div id="fund-error" role="alert"></div><div class="actions"><button id="fund-submit" class="primary" ${selected && !selected.is_available ? "disabled" : ""}>Review & fund gig</button>${link("browse?tab=contracts", "Check my contracts")}</div></form></div>`;
    const form = $("#fund-form");
    form.oninput = () => {
        draft.freelancerId = form.elements.freelancerId.value;
        draft.budget = form.elements.budget.value;
        draft.key = crypto.randomUUID();
        dirty = true;
        const amount = Number(draft.budget);
        $("#fund-preview").textContent =
            Number.isFinite(amount) && amount > 0
                ? `Expected remaining balance: ${money(c.data.escrow_balance - amount)}`
                : "Enter an amount greater than zero, with up to two decimal places.";
    };
    form.onsubmit = submitFunding;
    let workerPage = 1;
    async function loadWorkers() {
        const button = $("#fund-search-button");
        button.disabled = true;
        $("#worker-load").textContent = "Loading workers…";
        try {
            const r = await api(
                `freelancers?available=true&limit=10&page=${workerPage}&search=${encodeURIComponent($("#fund-search").value)}`,
            );
            if (ticket !== generation) return;
            const select = $("#fund-worker"),
                previous = select.value,
                old = select.selectedOptions[0];
            select.innerHTML =
                '<option value="">Choose a freelancer</option>' +
                r.data
                    .map(
                        (f) =>
                            `<option value="${f.id}">${esc(f.name)}</option>`,
                    )
                    .join("");
            if (
                previous &&
                !r.data.some((f) => String(f.id) === previous) &&
                old?.value
            )
                select.add(new Option(old.text, old.value));
            select.value = previous;
            $("#worker-load").textContent = r.total
                ? "Choose an available worker."
                : "No available workers match this search.";
            $("#worker-pages").innerHTML =
                `<button type="button" data-worker-page="-1" ${workerPage <= 1 ? "disabled" : ""}>Previous</button><span>Page ${workerPage} of ${r.totalPages || 1}</span><button type="button" data-worker-page="1" ${workerPage >= r.totalPages ? "disabled" : ""}>Next</button>`;
            $("#fund-submit").disabled = false;
        } catch (e) {
            if (ticket === generation)
                $("#worker-load").innerHTML =
                    `${esc(e.message)} <button type="button" id="retry-workers" class="secondary">Retry</button>`;
            $("#retry-workers")?.addEventListener("click", loadWorkers);
        } finally {
            if (ticket === generation) button.disabled = false;
        }
    }
    $("#fund-search-button").onclick = () => {
        workerPage = 1;
        loadWorkers();
    };
    $("#fund-search").onkeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            workerPage = 1;
            loadWorkers();
        }
    };
    $("#worker-pages").onclick = (e) => {
        const b = e.target.closest("[data-worker-page]");
        if (b && !b.disabled) {
            workerPage += Number(b.dataset.workerPage);
            loadWorkers();
        }
    };
    if (!selected) loadWorkers();
}
async function submitFunding(event) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    draft.freelancerId = form.elements.freelancerId.value;
    draft.budget = form.elements.budget.value;
    if (
        !draft.freelancerId ||
        !Number.isFinite(Number(draft.budget)) ||
        Number(draft.budget) <= 0
    ) {
        $("#fund-error").textContent =
            "Choose a freelancer and enter a budget greater than zero.";
        return;
    }
    const workerName = form.elements.freelancerId.selectedOptions[0].text;
    if (
        !confirm(
            `Fund a contract from ${actor.name} to ${workerName} for ${money(Number(draft.budget))}?`,
        )
    )
        return;
    pending = true;
    const button = $("#fund-submit");
    button.disabled = true;
    button.textContent = "Funding gig…";
    $("#actor-switch").disabled = true;
    $("#fund-error").textContent = "";
    form.querySelectorAll("input,select,button").forEach(
        (e) => (e.disabled = true),
    );
    try {
        const r = await api("contracts/fund", {
            method: "POST",
            headers: { "Idempotency-Key": draft.key },
            body: JSON.stringify({
                freelancerId: Number(draft.freelancerId),
                budget: draft.budget,
            }),
        });
        dirty = false;
        draft = null;
        notice(
            `Gig funded successfully. Balance: ${money(r.balanceBefore)} → ${money(r.balanceAfter)}. Audit entry #${r.audit.id}: ${money(r.audit.amount_changed)}.`,
        );
        go(`contract?id=${r.data.id}`);
    } catch (e) {
        $("#fund-error").innerHTML =
            `<p class="error">${esc(e.message)}</p>${link("browse?tab=contracts", "Check contracts before retrying")}`;
    } finally {
        pending = false;
        $("#actor-switch").disabled = false;
        if (document.contains(button)) {
            form.querySelectorAll("input,select,button").forEach(
                (e) => (e.disabled = false),
            );
            button.textContent = "Review & fund gig";
        }
    }
}
async function auditPage(ticket) {
    const name = "audit",
        s = pageState(name),
        id =
            actor.role === "client"
                ? actor.id
                : currentRoute.q.get("clientId") || s.filters.clientId || 1;
    filters(
        `${actor.role === "admin" ? `<label>Client ID<input type="number" name="clientId" min="1" required value="${id}"></label>` : ""}<label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label><button>Apply dates</button>`,
        name,
    );
    if (actor.role === "admin" && currentRoute.q.get("clientId"))
        $("#filters").elements.clientId.value = id;
    const q = new URLSearchParams({ ...s.filters, page: s.page, limit: 10 });
    const results = await Promise.allSettled([
        api(`clients/${id}`),
        api(`clients/${id}/audit?${q}`),
    ]);
    if (ticket !== generation) return;
    const [balance, history] = results;
    let html =
        balance.status === "fulfilled"
            ? `<div class="balance-strip">${esc(balance.value.data.name)} · Available balance <strong>${money(balance.value.data.escrow_balance)}</strong></div>`
            : `<p class="error">Balance unavailable: ${esc(balance.reason.message)}</p>`;
    if (history.status === "rejected") html += errorView(history.reason);
    else {
        const r = history.value;
        html += r.data.length
            ? table(
                  [
                      "Timestamp",
                      "Client",
                      "Action",
                      "Signed change",
                      "Balance after",
                  ],
                  r.data.map((a) => [
                      esc(date(a.timestamp)),
                      actor.role === "admin"
                          ? link(`client?id=${a.client_id}`, "#" + a.client_id)
                          : "#" + a.client_id,
                      esc(a.action_type.replaceAll("_", " ")),
                      `${a.amount_changed > 0 ? "+" : ""}${money(a.amount_changed)}`,
                      money(a.balance_after),
                  ]),
              )
            : empty("No balance changes recorded for these dates.");
        pagination(r, name);
    }
    $("#content").innerHTML = html;
}
function bars(rows, label, value) {
    const max = Math.max(1, ...rows.map((r) => r[value]));
    return rows
        .map(
            (r) =>
                `<div class="bar-row"><span>${esc(r[label])}</span><div class="bar"><i style="width:${(r[value] / max) * 100}%"></i></div><span>${r[value]}</span></div>`,
        )
        .join("");
}
async function selectFreelancer(ticket,name,id) {
    if (actor.role !== "freelancer") {
        filters(`<label>${actor.role==="admin"?"Search by name or ID":"Find freelancer by name"}<input type="search" name="search" placeholder="${actor.role==="admin"?"Name or freelancer ID":"Freelancer name"}"></label>${actor.role==="client"&&name==="analytics"?'<label>Show<select name="workedWith"><option value="">All freelancers</option><option value="true">Previously worked with</option></select></label>':''}<button type="button" id="analytics-search">Search</button><label>Choose freelancer<select name="freelancerId" required><option value="">Loading freelancers…</option></select></label><button>${name === "reviews" ? "View portfolio & reviews" : "View analytics"}</button><div id="analytics-options" role="status"></div><div id="analytics-option-pages" class="actions"></div>`,name);
        let optionPage=1,optionRequest=0;
        async function loadOptions(initial=false){
            const request=++optionRequest;
            const form=$("#filters"),select=form.elements.freelancerId;
            const previous=select.value||id;
            $("#analytics-options").textContent="Loading freelancers…";
            try {
                const q=new URLSearchParams({page:optionPage,limit:10,search:form.elements.search.value});
                if(form.elements.workedWith?.value)q.set("workedWith",form.elements.workedWith.value);
                const result=await api("freelancers?"+q);
                if(ticket!==generation||request!==optionRequest)return;
                let chosen=result.data.find(f=>String(f.id)===String(previous));
                // Preserve profile deep links only on the initial unrestricted selection load.
                if(initial&&previous&&!chosen&&!q.get("workedWith"))chosen=(await api(`freelancers/${previous}`)).data;
                if(ticket!==generation||request!==optionRequest)return;
                const options=[...result.data];if(chosen&&!options.some(f=>f.id===chosen.id))options.push(chosen);
                select.innerHTML='<option value="">Choose a freelancer</option>'+options.map(f=>`<option value="${f.id}">${esc(f.name)}${actor.role==="admin"?` · ID ${f.id}`:""}</option>`).join('');
                select.value=String(chosen?.id||result.data[0]?.id||'');
                $("#analytics-options").textContent=result.total?`${result.total} matching freelancers${q.get('workedWith')?' with in-progress or completed contracts with you':''}.`:'No matching freelancers. Try All freelancers or another name.';
                $("#analytics-option-pages").innerHTML=`<button type="button" data-option-page="-1" ${optionPage<=1?'disabled':''}>Previous names</button><span>Page ${optionPage} of ${result.totalPages||1}</span><button type="button" data-option-page="1" ${optionPage>=result.totalPages?'disabled':''}>Next names</button>`;
                return select.value;
            }catch(error){if(ticket===generation&&request===optionRequest)$("#analytics-options").innerHTML=`${esc(error.message)} <button type="button" id="analytics-option-retry">Retry</button>`;$("#analytics-option-retry")?.addEventListener('click',()=>loadOptions());}
        }
        $("#analytics-search").onclick=()=>{optionPage=1;loadOptions();};
        $("#filters").elements.search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();optionPage=1;loadOptions();}};
        if($("#filters").elements.workedWith)$("#filters").elements.workedWith.onchange=()=>{optionPage=1;loadOptions();};
        $("#analytics-option-pages").onclick=event=>{const button=event.target.closest('[data-option-page]');if(button&&!button.disabled){optionPage+=Number(button.dataset.optionPage);loadOptions();}};
        const selection=await loadOptions(true);
        if(ticket!==generation)return;
        id=selection;
        if(!id){$("#content").innerHTML=empty("Choose a freelancer to view analytics.");return;}
    }else filters('',name);
    return id;
}
async function analytics(ticket) {
    const name = "analytics", s = pageState(name);
    let id = actor.role === "freelancer" ? actor.id : currentRoute.q.get("freelancerId") || s.filters.freelancerId;
    id=await selectFreelancer(ticket,name,id);
    if(ticket!==generation||!id)return;
    const [series, earnings, ranks] = await Promise.all([
        api(`analytics/revenue?freelancerId=${id}`),
        api(`analytics/lifetime-earnings?freelancerId=${id}`),
        api(`analytics/rankings?freelancerId=${id}&page=${s.page}&limit=10`),
    ]);
    if (ticket !== generation) return;
    const summary = earnings.data.find((r) => r.freelancer_id === Number(id));
    const max = Math.max(1, ...series.data.map((r) => r.moving_average));
    const points = series.data
        .map(
            (r, i) =>
                `${40 + (i * 620) / Math.max(1, series.data.length - 1)},${170 - (r.moving_average / max) * 140}`,
        )
        .join(" ");
    $("#content").innerHTML =
        `<div class="cards"><div class="card"><h3>${esc(summary?.name || actor.name || "Freelancer")} · Seven-day revenue average</h3>${series.data.length ? `<svg viewBox="0 0 700 210" role="img" aria-label="Seven day moving average of revenue"><line x1="40" y1="170" x2="660" y2="170" stroke="#0d0d0d33"/><polyline points="${points}" fill="none" stroke="#f2336b" stroke-width="3"/>${series.data.map((r, i) => `<circle cx="${40 + (i * 620) / Math.max(1, series.data.length - 1)}" cy="${170 - (r.moving_average / max) * 140}" r="4" fill="#0d0d0d"><title>${esc(r.date)}: ${money(r.moving_average)}</title></circle>`).join("")}<text x="40" y="195" class="chart-label">${esc(series.data[0].date)}</text><text x="560" y="195" class="chart-label">${esc(series.data.at(-1).date)}</text></svg>` : "<p>No completed revenue yet.</p>"}<p>${esc(series.measure)}</p></div><div class="card"><h3>${esc(summary?.name || "Worker")} · Lifetime summary</h3><h1>${money(summary?.total || 0)}</h1><p>${summary?.completed || 0} completed contracts<br>Snapshot refreshed: ${earnings.lastRefreshed ? esc(date(earnings.lastRefreshed)) : "Not refreshed yet"}</p><p>Stored lifetime totals can lag contract changes. Refresh earnings to rebuild the summary.</p><button class="secondary" id="refresh-earnings">Refresh earnings</button></div></div><div class="section-caption"><h3>Dense ranking · All platform freelancers</h3><p>Compares all platform freelancers with completed revenue, not just those a client has worked with. ${actor.role === "freelancer" ? "Only your own global rank is shown. " : ""}${esc(ranks.measure)} · ties share a rank.</p></div>${
            ranks.data.length
                ? table(
                      [
                          "Rank",
                          "Freelancer",
                          "Latest recorded day",
                          "Moving average",
                      ],
                      ranks.data.map((r) => [
                          r.revenue_rank,
                          link(`worker?id=${r.freelancer_id}`, r.name),
                          r.date,
                          money(r.moving_average),
                      ]),
                  )
                : empty("No completed revenue yet.")
        }`;
    pagination(ranks, "analytics");
}
function project(lat, lng, zoom = 12) {
    const size = 256 * 2 ** zoom,
        sin = Math.sin((lat * Math.PI) / 180);
    return {
        x: ((lng + 180) / 360) * size,
        y:
            (0.5 -
                Math.log(
                    (1 + Math.min(0.9999, Math.max(-0.9999, sin))) /
                        (1 - Math.min(0.9999, Math.max(-0.9999, sin))),
                ) /
                    (4 * Math.PI)) *
            size,
    };
}
function mapHTML(lat, lng, workers, options = {}) {
    const zoom=options.zoom || 12, center=options.center || project(Math.max(-85, Math.min(85, lat)),lng,zoom), width=options.width || 640, height=options.height || 340;
    const origin=project(Math.max(-85,Math.min(85,lat)),lng,zoom);
    const count=2**zoom;
    const left=Math.floor((center.x-width/2)/256),right=Math.floor((center.x+width/2-1)/256);
    const top=Math.floor((center.y-height/2)/256),bottom=Math.floor((center.y+height/2-1)/256);
    let tiles="";
    for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++){
        if(y<0||y>=count)continue;
        tiles+=`<img class="map-tile" alt="" decoding="async" src="https://tile.openstreetmap.org/${zoom}/${((x%count)+count)%count}/${y}.png" style="left:${x*256-center.x+width/2}px;top:${y*256-center.y+height/2}px">`;
    }
    return `<div class="map-frame"><div class="map-canvas" style="width:${width}px;height:${height}px" role="region" aria-label="Map showing the job site and available workers">${tiles}<span class="origin-marker" style="left:${origin.x-center.x+width/2}px;top:${origin.y-center.y+height/2}px" title="Your selected location">◎</span>${workers
        .map((f, i) => {
            const p = project(f.latitude, f.longitude,zoom);
            return `<a class="worker-marker" style="left:${p.x - center.x + width/2}px;top:${p.y - center.y + height/2}px" href="#worker?id=${f.id}&from=nearby" aria-label="${esc(f.name)} ${(f.distance_meters / 1000).toFixed(2)} km away">${i + 1}</a>`;
        })
        .join(
            "",
        )}</div><div id="map-fallback" class="map-fallback" hidden>Map tiles unavailable. Use the distance-sorted list below.</div><a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></div>`;
}
let mapResults=null, mapView=null;
function drawLargeMap(){
    const viewport=$("#map-viewport");if(!viewport||!mapView||!mapResults)return;
    const cached=new Map([...viewport.querySelectorAll('.map-tile')].map(img=>[img.src,img]));
    const template=document.createElement('template');
    template.innerHTML=mapHTML(mapResults.lat,mapResults.lng,mapResults.workers,{...mapView,width:viewport.clientWidth,height:viewport.clientHeight});
    template.content.querySelectorAll('.map-tile').forEach(img=>{const previous=cached.get(img.src);if(previous){previous.style.cssText=img.style.cssText;img.replaceWith(previous);}});
    viewport.replaceChildren(template.content);
    viewport.querySelectorAll('.map-tile').forEach(img=>img.onerror=()=>{const note=$("#map-fallback");if(note)note.hidden=false;});
}
function openLargeMap(){
    if(!mapResults)return;
    const dialog=$("#map-dialog");
    dialog.innerHTML='<div class="dialog-heading"><div><h2 id="map-heading">Nearby workers</h2><p>Drag to pan · use + / − to zoom · ◎ your location · numbered markers are workers on this page</p></div><button id="close-map" class="secondary" aria-label="Close map">✕</button></div><div class="map-toolbar"><button id="map-zoom-in" class="secondary" aria-label="Zoom in">+</button><button id="map-zoom-out" class="secondary" aria-label="Zoom out">−</button><button id="map-recenter" class="secondary">Back to my location</button></div><div id="map-viewport" tabindex="0" aria-label="Interactive nearby worker map. Arrow keys pan, plus and minus zoom."></div>';
    dialog.showModal();
    const radius=Math.max(0,...mapResults.workers.map(worker=>worker.distance_meters))+500;
    const side=$("#map-viewport").clientWidth;
    const initialZoom=Math.max(0,Math.min(17,Math.floor(Math.log2(156543.03392*Math.cos(mapResults.lat*Math.PI/180)*side/(2*radius)))));
    mapView={zoom:initialZoom,minZoom:initialZoom,center:project(mapResults.lat,mapResults.lng,initialZoom)};
    drawLargeMap();
    $("#close-map").onclick=()=>dialog.close();
    function zoom(delta){const next=Math.max(mapView.minZoom,Math.min(17,mapView.zoom+delta));const scale=2**(next-mapView.zoom);mapView.center={x:mapView.center.x*scale,y:mapView.center.y*scale};mapView.zoom=next;drawLargeMap();}
    $("#map-zoom-in").onclick=()=>zoom(1);$("#map-zoom-out").onclick=()=>zoom(-1);
    $("#map-recenter").onclick=()=>{mapView.center=project(mapResults.lat,mapResults.lng,mapView.zoom);drawLargeMap();};
    const viewport=$("#map-viewport");let drag=null,moved=false;
    viewport.onpointerdown=event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,center:{...mapView.center}};moved=false;if(!event.target.closest('a'))viewport.setPointerCapture(event.pointerId);};
    viewport.onpointermove=event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;if(moved){mapView.center={x:drag.center.x-dx,y:drag.center.y-dy};drawLargeMap();}};
    viewport.onpointerup=viewport.onpointercancel=()=>{drag=null;};
    viewport.addEventListener('click',event=>{if(moved){event.preventDefault();event.stopPropagation();moved=false;}else if(event.target.closest('.worker-marker'))dialog.close();},true);
    viewport.onkeydown=event=>{const offsets={ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]};if(offsets[event.key]){event.preventDefault();const [x,y]=offsets[event.key];mapView.center.x+=x;mapView.center.y+=y;drawLargeMap();}else if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?-1:1);}};
    dialog.onclick=event=>{if(event.target===dialog)dialog.close();};
}
window.addEventListener('resize',()=>{if($("#map-dialog").open)drawLargeMap();});
let locating = false;
async function browserLocation(ticket) {
    if (locating) return;
    const feedback = $("#location-feedback");
    if (!navigator.geolocation || !window.isSecureContext) {
        feedback.innerHTML = 'Browser location requires HTTPS or localhost. <button class="secondary" data-demo-location>Try seeded Hyderabad location</button>';
        return;
    }
    locating = true;
    const button = $("#use-location");
    button.disabled = true; button.textContent = "Waiting for location permission…";
    feedback.textContent = "Allow location access in your browser. If asked, enable your device location service.";
    navigator.geolocation.getCurrentPosition(position => {
        locating = false;
        if (ticket !== generation) return;
        const s = pageState("nearby");
        s.filters = {lat:String(position.coords.latitude),lng:String(position.coords.longitude)};
        s.source = "Browser location"; s.accuracy = position.coords.accuracy; s.page = 1;
        persist(); render();
    }, error => {
        locating = false;
        if (ticket !== generation) return;
        button.disabled = false; button.textContent = "Use my location";
        const messages = {1:"Location permission was denied. Enable location for this site in browser settings, then retry.",2:"Your device could not find a location. Turn on location services and retry.",3:"Location lookup timed out. Check location services and retry."};
        feedback.innerHTML = `${esc(messages[error.code] || "Could not get location. Please retry.")} <button class="secondary" data-demo-location>Try seeded Hyderabad location</button>`;
    }, {enableHighAccuracy:true,timeout:15000,maximumAge:60000});
}
async function nearby(ticket, background = false) {
    const s = pageState("nearby");
    if (!background) {
        $("#filters").innerHTML = '<button type="button" id="use-location">Use my location</button><span id="location-feedback" role="status"></span>';
        $("#use-location").onclick = () => browserLocation(ticket);
    }
    if (s.filters.lat === undefined || s.filters.lng === undefined) {
        $("#content").innerHTML = empty("Share your location to find available workers within 5 km.", "Click Use my location and allow the browser permission prompt. Demo workers are based in Hyderabad (17.45452, 78.35008).");
        // Reuse an existing grant automatically; never force a permission prompt on page entry.
        if (navigator.permissions && navigator.geolocation) {
            navigator.permissions.query({name:"geolocation"}).then(permission => {
                if (permission.state === "granted" && ticket === generation) browserLocation(ticket);
            }).catch(() => {});
        }
        return;
    }
    if (background && $("#map-freshness")) $("#map-freshness").textContent = "Refreshing nearby workers…";
    try {
        const r = await api("workers/nearby?" + new URLSearchParams({...s.filters,page:s.page,limit:10}));
        if (ticket !== generation) return;
        const source = s.source || "Browser location";
        mapResults={lat:Number(s.filters.lat),lng:Number(s.filters.lng),workers:r.data};
        $("#content").innerHTML = `<div class="balance-strip"><strong>${esc(source)}</strong> · ${Number(s.filters.lat).toFixed(5)}, ${Number(s.filters.lng).toFixed(5)}${s.accuracy ? ` · accuracy approximately ${Math.round(s.accuracy)} m` : ""}<br>${r.total ?? r.data.length} available workers within 5 km. Distances are measured from your selected location.</div>` +
        (r.data.length ? table(["Worker","Distance from you","Location updated",""],r.data.map(f=>[person(f),(f.distance_meters/1000).toFixed(2)+" km",esc(date(f.location_updated_at)),`${link(`worker?id=${f.id}&from=nearby`,"View profile")} ${actor.role==="client"?link(`fund?freelancerId=${f.id}`,"Choose worker"):""}`])) : empty("No available workers within 5 km of your location.", 'Demo records are in Hyderabad. <button class="secondary" data-demo-location>Try seeded Hyderabad location</button>')) +
        `<div class="map-section"><p id="map-freshness">Updated ${esc(new Date().toLocaleTimeString())} · Polls every 15 seconds · Current origin marked ◎.</p><button type="button" class="secondary" id="open-map">⤢ Open large map</button></div>`;
        $("#open-map").onclick=openLargeMap;
        if($("#map-dialog").open)drawLargeMap();
        if (r.total !== undefined) pagination(r,"nearby");
        document.querySelectorAll(".map-tile").forEach(img=>img.onerror=()=>{const note=$("#map-fallback");if(note)note.hidden=false;});
    } catch(error) {
        if(ticket!==generation)return;
        if(background&&$("#map-freshness"))$("#map-freshness").innerHTML=`${esc(error.message)} <button data-retry class="secondary">Retry</button>`;
        else throw error;
    }
}
async function reviewsPage(ticket) {
    const s=pageState("reviews");
    let id=actor.role==='freelancer'?actor.id:currentRoute.q.get('freelancerId')||s.filters.freelancerId;
    id=await selectFreelancer(ticket,'reviews',id);
    if(ticket!==generation||!id)return;
    const [p, r, entries] = await Promise.all([
        api(`freelancers/${id}/portfolio`),
        api(`reviews/analytics?freelancerId=${id}`),
        api(`reviews?freelancerId=${id}&page=${s.page}&limit=10`),
    ]);
    if (ticket !== generation) return;
    $("#content").innerHTML =
        `<div class="cards">${portfolio(p.data)}<div class="card"><h3>Rating distribution · ${esc(r.scope)}</h3><p>${r.total_reviews ? `${r.average_rating.toFixed(1)} / 5 · ${r.total_reviews} reviews` : "No reviews yet."}</p>${r.total_reviews ? bars(r.rating_distribution, "rating", "review_count") : ""}</div><div class="card"><h3>Top skill tags · selected worker</h3>${r.total_reviews ? bars(r.top_skill_tags, "skill_tag", "tag_count") : "<p>No review tags yet.</p>"}</div></div>${
            entries.data.length
                ? table(
                      ["Rating", "Review", "Skill tags", "Created"],
                      entries.data.map((r) => [
                          r.rating + " / 5",
                          esc(r.review_text),
                          r.skill_tags.map(esc).join(", "),
                          esc(date(r.created_at)),
                      ]),
                  )
                : empty("No reviews yet.")
        }`;
    pagination(entries, "reviews");
}
async function render() {
    if($("#map-dialog").open)$("#map-dialog").close();
    const ticket = ++generation;
    clearInterval(poll);
    poll = null;
    currentRoute = route();
    header();
    editorial(actor ? currentRoute.name : "welcome");
    $("#title").textContent = publicNames[currentRoute.name];
    $("#breadcrumb").textContent = publicNames[currentRoute.name];
    $("#panel-title").textContent = publicNames[currentRoute.name];
    $("#panel-description").textContent = "";
    $("#tabs").innerHTML = "";
    $("#filters").innerHTML = "";
    $("#pagination").innerHTML = "";
    $("#stats").innerHTML = "";
    if (!actor) {
        $("#title").textContent = "Welcome to GigTask";
        $("#content").innerHTML = empty(
            "Choose a role and seeded actor to enter your workspace.",
            '<button class="primary" data-choose-actor>Choose demo actor</button>',
        );
        openActor();
        return;
    }
    if (!allowed(currentRoute.name)) {
        $("#content").innerHTML = errorView(
            new Error(
                "Access denied. This page is not available for the selected role.",
            ),
        );
        return;
    }
    $("#content").innerHTML =
        `<div class="message">Loading your workspace…<span class="quote">${esc(pick(LOADING_QUOTES, currentRoute.name))}</span></div>`;
    stats(ticket);
    try {
        const handlers = {
            browse,
            worker: workerDetails,
            contract: contractDetails,
            client: clientDetails,
            fund,
            audit: auditPage,
            analytics,
            nearby,
            reviews: reviewsPage,
        };
        await handlers[currentRoute.name](ticket);
        if (currentRoute.name === "nearby" && ticket === generation)
            poll = setInterval(() => {
                if (!document.hidden && !pending) nearby(ticket, true);
            }, 15000);
    } catch (e) {
        if (ticket === generation) {
            $("#content").innerHTML = errorView(e);
            if (e.status === 401)
                notice(
                    "Your saved demo actor is unavailable. Choose an actor again.",
                    true,
                );
        }
    }
}
async function loadActors() {
    const ticket = ++actorGeneration;
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
            `actors?role=${role}&page=${actorPage}&limit=10&search=${encodeURIComponent($("#actor-search").value)}`,
        );
        if (ticket !== actorGeneration) return;
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
        actorTotalPages = r.totalPages;
        $("#actor-pages").innerHTML =
            `<button type="button" data-actor-page="-1" ${actorPage <= 1 ? "disabled" : ""}>Previous</button><span>Page ${actorPage} of ${r.totalPages || 1}</span><button type="button" data-actor-page="1" ${actorPage >= r.totalPages ? "disabled" : ""}>Next</button>`;
    } catch (e) {
        if (ticket === actorGeneration)
            $("#actor-error").textContent = e.message;
    }
}
function openActor() {
    if (pending) return;
    $("#actor-role").value = actor?.role || "";
    $("#actor-search").value = "";
    actorPage = 1;
    $("#close-actor").hidden = !actor;
    $("#actor-dialog").showModal();
    loadActors();
}
$("#actor-switch").onclick = openActor;
$("#close-actor").onclick = () => $("#actor-dialog").close();
$("#actor-dialog").addEventListener("cancel", (e) => {
    if (!actor) e.preventDefault();
});
$("#actor-role").onchange = () => {
    actorPage = 1;
    $("#actor-search").value = "";
    loadActors();
};
$("#actor-search-button").onclick = () => {
    actorPage = 1;
    loadActors();
};
$("#actor-search").onkeydown = (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        actorPage = 1;
        loadActors();
    }
};
$("#actor-id").onchange = () =>
    ($("#actor-continue").disabled = !$("#actor-id").value);
$("#actor-retry").onclick = loadActors;
$("#actor-pages").onclick = (e) => {
    const b = e.target.closest("[data-actor-page]");
    if (b && !b.disabled) {
        actorPage += Number(b.dataset.actorPage);
        loadActors();
    }
};
$("#actor-form").onsubmit = (e) => {
    e.preventDefault();
    const role = $("#actor-role").value,
        id = Number($("#actor-id").value);
    if (!role || (role !== "admin" && !id)) return;
    if (
        dirty &&
        !confirm(
            "Switch actor and discard these changes? Choose Cancel to stay.",
        )
    )
        return;
    const previous = actor;
    actor = {
        role,
        id: role === "admin" ? null : id,
        name:
            role === "admin"
                ? "Admin"
                : $("#actor-id").selectedOptions[0].text.replace(/ #\d+$/, ""),
    };
    saveStorage("gigtask.actor", actor);
    state = {};
    persist();
    draft = null;
    dirty = false;
    notice("");
    $("#actor-dialog").close();
    if (previous) go("browse");
    else if (allowed(route().name)) render();
    else go("browse");
};
$("#filters").onsubmit = (e) => {
    e.preventDefault();
    const name =
        currentRoute.name === "browse"
            ? "browse-" + browseEntity()
            : currentRoute.name;
    pageState(name).filters = Object.fromEntries(new FormData(e.currentTarget));
    pageState(name).page = 1;
    persist();
    if (
        ["analytics", "reviews", "audit"].includes(currentRoute.name) &&
        currentRoute.q.toString()
    )
        go(currentRoute.name);
    else render();
};
$("#pagination").onclick = (e) => {
    const b = e.target.closest("[data-page]");
    if (b && !b.disabled) {
        pageState($("#pagination").dataset.state).page += Number(
            b.dataset.page,
        );
        persist();
        render();
    }
};
$("#refresh").onclick = () => {
    if (!pending) render();
};
document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-demo-location]")) {
        const s=pageState("nearby");
        s.filters={lat:"17.45452",lng:"78.35008"};
        s.source="Seeded Hyderabad demo location (not browser GPS)";s.accuracy=null;s.page=1;persist();render();return;
    }

    if (e.target.closest("[data-retry]")) {
        if (!pending) render();
        return;
    }
    if (e.target.closest("[data-choose-actor]")) {
        openActor();
        return;
    }
    const refreshButton = e.target.closest("#refresh-earnings");
    if (refreshButton) {
        if (pending) return;
        pending = true; refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing earnings…";
        $("#actor-switch").disabled = true;
        try {
            await api("analytics/lifetime-earnings/refresh", {method: "POST", body: "{}"});
            notice("Lifetime earnings refreshed successfully.");
            render();
        } catch (error) { notice(error.message, true); }
        finally {
            pending = false; $("#actor-switch").disabled = false;
            if (document.contains(refreshButton)) { refreshButton.disabled = false; refreshButton.textContent = "Refresh earnings"; }
        }
        return;
    }
    const b = e.target.closest("#status-action");
    if (!b || pending) return;
    if (!confirm(`${b.textContent} for contract #${b.dataset.id}?`)) return;
    pending = true;
    b.disabled = true;
    const label = b.textContent;
    b.textContent = "Updating…";
    $("#actor-switch").disabled = true;
    $("#action-error").textContent = "";
    try {
        await api(`contracts/${b.dataset.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: b.dataset.status }),
        });
        notice("Contract status updated successfully.");
        render();
    } catch (error) {
        if ($("#action-error"))
            $("#action-error").innerHTML =
                `<p class="error">${esc(error.message)}</p>`;
    } finally {
        pending = false;
        $("#actor-switch").disabled = false;
        if (document.contains(b)) {
            b.disabled = false;
            b.textContent = label;
        }
    }
});
// Guard both links and browser back/forward against discarding a funding draft.
let lastHash = location.hash || "#browse";
window.addEventListener("hashchange", () => {
    if (pending) {
        history.replaceState(null, "", lastHash);
        return;
    }
    if (dirty && currentRoute?.name === "fund" && route().name !== "fund") {
        if (!confirm("Leave this funding form and discard your changes?")) {
            history.replaceState(null, "", lastHash);
            return;
        }
        dirty = false;
        draft = null;
    }
    lastHash = location.hash;
    render();
});
window.addEventListener("beforeunload", (e) => {
    if (dirty || pending) {
        e.preventDefault();
        e.returnValue = "";
    }
});
render();

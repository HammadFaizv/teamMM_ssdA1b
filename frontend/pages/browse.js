import { pageState, persist, session } from '../shared/state.js';
import { $, badge, date, empty, esc, filters, link, money, pagination, person, table } from '../shared/ui.js';
import { api } from '../shared/api.js';

export function browseEntity() {
    const requested = session.currentRoute.q.get("tab") || pageState("browse").tab;
    const choices =
        session.actor.role === "admin"
            ? ["clients", "freelancers", "contracts"]
            : session.actor.role === "client"
              ? ["contracts", "freelancers"]
              : ["contracts", "freelancers"];
    return choices.includes(requested) ? requested : choices[0];
}

export async function browse(ticket) {
    const entity = browseEntity();
    pageState("browse").tab = entity;
    persist();
    const tabs =
        session.actor.role === "admin"
            ? ["clients", "freelancers", "contracts"]
            : ["contracts", "freelancers"];
    $("#tabs").innerHTML = tabs
        .map((t) =>
            link(
                `browse?tab=${t}`,
                session.actor.role === "admin"
                    ? t
                    : t === "contracts"
                      ? "My contracts"
                      : session.actor.role === "freelancer"
                        ? "My profile"
                        : "Freelancers",
                `tab ${t === entity ? "selected" : ""}`,
            ),
        )
        .join("");
    const key = "browse-" + entity,
        s = pageState(key);
    filters(
        `<input name="search" type="search" aria-label="${session.actor.role === "admin" ? "Search by name or ID" : "Search by freelancer name"}" placeholder="${session.actor.role === "admin" ? "Search by name or ID" : "Search by freelancer name"}…">${entity === "contracts" ? '<select name="status" aria-label="Status"><option value="">All statuses</option><option>FUNDED</option><option>IN_PROGRESS</option><option>COMPLETED</option></select>' : ""}<button>Search</button>`,
        key,
    );
    const q = new URLSearchParams({ ...s.filters, page: s.page, limit: 10 });
    if (session.currentRoute.q.get("clientId"))
        q.set("clientId", session.currentRoute.q.get("clientId"));
    const r = await api(`${entity}?${q}`);
    if (ticket !== session.generation) return;
    if (!r.data.length)
        $("#content").innerHTML = empty(
            "No records match this view.",
            session.actor.role === "client" && entity === "contracts"
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
                esc(c.client_name || session.actor.name),
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

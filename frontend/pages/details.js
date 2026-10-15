import { render } from '../shared/render.js';
import { $, notice, badge, date, esc, link, money } from '../shared/ui.js';
import { api } from '../shared/api.js';
import { portfolio } from '../shared/components.js';
import { session } from '../shared/state.js';

export function back(fallback) {
    const from = session.currentRoute.q.get("from");
    return link(
        from && /^(browse|nearby)(\?|$)/.test(from) ? from : fallback,
        "← Back",
    );
}

export async function workerDetails(ticket) {
    const id = session.currentRoute.q.get("id");
    const [f, p, r] = await Promise.all([
        api(`freelancers/${id}`),
        api(`freelancers/${id}/portfolio`),
        api(`reviews/analytics?freelancerId=${id}`),
    ]);
    if (ticket !== session.generation) return;
    $("#content").innerHTML =
        `<div class="detail-page">${back("browse?tab=freelancers")}<div class="detail-hero"><div><h2>${esc(f.data.name)}</h2><p>Freelancer #${f.data.id} · ${esc(f.data.skill)}</p></div>${badge(f.data.is_available ? "Available" : "Busy")}</div>${portfolio(p.data)}<div class="actions">${link(`reviews?freelancerId=${id}`, "Read reviews")}${link(`analytics?freelancerId=${id}`, "View analytics")}${session.actor.role === "client" ? (f.data.is_available ? link(`fund?freelancerId=${id}`, "Fund gig with this worker", "primary") : '<span class="muted">Worker unavailable — funding disabled.</span>') : ""}</div><p>${r.total_reviews ? `${r.average_rating.toFixed(1)} / 5 · ${r.total_reviews} reviews` : "No reviews yet."}</p></div>`;
}

export async function contractDetails(ticket) {
    const id = session.currentRoute.q.get("id");
    const { data: c } = await api(`contracts/${id}`);
    if (ticket !== session.generation) return;
    const action =
        session.actor.role !== "admin"
            ? {
                  FUNDED: ["Start work", "IN_PROGRESS"],
                  IN_PROGRESS: ["Mark completed", "COMPLETED"],
              }[c.status]
            : null;
    $("#content").innerHTML =
        `<div class="detail-page">${back("browse?tab=contracts")}<div class="detail-hero"><h2>Contract #${c.id}</h2>${badge(c.status)}</div><dl><dt>Client</dt><dd>#${c.client_id}</dd><dt>Freelancer</dt><dd>${link(`worker?id=${c.freelancer_id}`, "Freelancer #" + c.freelancer_id)}</dd><dt>Reserved budget</dt><dd>${money(c.budget)}</dd><dt>Created</dt><dd>${esc(date(c.created_at))}</dd></dl><div id="action-error" role="alert"></div><div class="actions">${action ? `<button class="primary" id="status-action" data-id="${c.id}" data-status="${action[1]}">${action[0]}</button>` : `<p>${c.status === "COMPLETED" ? "Completed contract. No further actions." : "Admin is read only."}</p>`}${session.actor.role === "client" ? link("audit", "View my audit trail") : ""}</div><p>Completion records revenue for analytics; it does not pay out a freelancer wallet.</p></div>`;
}

export async function clientDetails(ticket) {
    const id = session.currentRoute.q.get("id"),
        r = await api(`clients/${id}`);
    if (ticket !== session.generation) return;
    $("#content").innerHTML =
        `<div class="detail-page">${back("browse?tab=clients")}<h2>${esc(r.data.name)}</h2><p>Available demo balance: ${money(r.data.escrow_balance)}</p><div class="actions">${link(`browse?tab=contracts&clientId=${id}`, "View contracts")}${link(`audit?clientId=${id}`, "View audit history")}</div></div>`;
}


export async function updateContractStatus(b) {
    if (!b || session.pending) return;
    if (!confirm(`${b.textContent} for contract #${b.dataset.id}?`)) return;
    session.pending = true;
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
        session.pending = false;
        $("#actor-switch").disabled = false;
        if (document.contains(b)) {
            b.disabled = false;
            b.textContent = label;
        }
    }
}

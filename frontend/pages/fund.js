import { $, esc, link, money, notice } from '../shared/ui.js';
import { api } from '../shared/api.js';
import { go } from '../shared/router.js';
import { session } from '../shared/state.js';

export async function fund(ticket) {
    if (!session.draft || session.draft.actorId !== session.actor.id) {
        session.draft = {
            actorId: session.actor.id,
            freelancerId: session.currentRoute.q.get("freelancerId") || "",
            budget: "",
            key: crypto.randomUUID(),
        };
    }
    const c = await api(`clients/${session.actor.id}`);
    let selected = null;
    if (session.draft.freelancerId)
        selected = (await api(`freelancers/${session.draft.freelancerId}`)).data;
    if (ticket !== session.generation) return;
    $("#content").innerHTML =
        `<div class="detail-page"><p>Funding deducts the selected amount from your seeded balance and reserves it in a FUNDED contract. No external payment is made.</p><form id="fund-form"><div class="cards"><div class="card"><h3>1. Choose worker</h3><label>Find a freelancer<input id="fund-search" type="search" placeholder="Search freelancer names"></label><button id="fund-search-button" type="button" class="secondary">Search workers</button><label>Selected freelancer<select id="fund-worker" name="freelancerId" required><option value="">Choose a freelancer</option>${selected ? `<option selected value="${selected.id}">${esc(selected.name)}${selected.is_available ? "" : " · unavailable"}</option>` : ""}</select></label><p id="worker-load" role="status"></p><div id="worker-pages" class="pagination"></div></div><div class="card"><h3>2. Budget & review</h3><p>Client: ${esc(session.actor.name)} #${session.actor.id}<br>Available balance: <strong>${money(c.data.escrow_balance)}</strong></p><label>Budget (INR)<input name="budget" id="fund-budget" type="text" inputmode="decimal" required pattern="(?:0|[1-9][0-9]{0,6})(?:\\.[0-9]{1,2})?" value="${esc(session.draft.budget)}" placeholder="500.00"></label><p id="fund-preview"></p></div></div><div id="fund-error" role="alert"></div><div class="actions"><button id="fund-submit" class="primary" ${selected && !selected.is_available ? "disabled" : ""}>Review & fund gig</button>${link("browse?tab=contracts", "Check my contracts")}</div></form></div>`;
    const form = $("#fund-form");
    form.oninput = () => {
        session.draft.freelancerId = form.elements.freelancerId.value;
        session.draft.budget = form.elements.budget.value;
        session.draft.key = crypto.randomUUID();
        session.dirty = true;
        const amount = Number(session.draft.budget);
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
            if (ticket !== session.generation) return;
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
            if (ticket === session.generation)
                $("#worker-load").innerHTML =
                    `${esc(e.message)} <button type="button" id="retry-workers" class="secondary">Retry</button>`;
            $("#retry-workers")?.addEventListener("click", loadWorkers);
        } finally {
            if (ticket === session.generation) button.disabled = false;
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

export async function submitFunding(event) {
    event.preventDefault();
    if (session.pending) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    session.draft.freelancerId = form.elements.freelancerId.value;
    session.draft.budget = form.elements.budget.value;
    if (
        !session.draft.freelancerId ||
        !Number.isFinite(Number(session.draft.budget)) ||
        Number(session.draft.budget) <= 0
    ) {
        $("#fund-error").textContent =
            "Choose a freelancer and enter a budget greater than zero.";
        return;
    }
    const workerName = form.elements.freelancerId.selectedOptions[0].text;
    if (
        !confirm(
            `Fund a contract from ${session.actor.name} to ${workerName} for ${money(Number(session.draft.budget))}?`,
        )
    )
        return;
    session.pending = true;
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
            headers: { "Idempotency-Key": session.draft.key },
            body: JSON.stringify({
                freelancerId: Number(session.draft.freelancerId),
                budget: session.draft.budget,
            }),
        });
        session.dirty = false;
        session.draft = null;
        notice(
            `Gig funded successfully. Balance: ${money(r.balanceBefore)} → ${money(r.balanceAfter)}. Audit entry #${r.audit.id}: ${money(r.audit.amount_changed)}.`,
        );
        go(`contract?id=${r.data.id}`);
    } catch (e) {
        $("#fund-error").innerHTML =
            `<p class="error">${esc(e.message)}</p>${link("browse?tab=contracts", "Check contracts before retrying")}`;
    } finally {
        session.pending = false;
        $("#actor-switch").disabled = false;
        if (document.contains(button)) {
            form.querySelectorAll("input,select,button").forEach(
                (e) => (e.disabled = false),
            );
            button.textContent = "Review & fund gig";
        }
    }
}

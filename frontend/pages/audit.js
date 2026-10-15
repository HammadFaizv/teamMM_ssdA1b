import { $, date, empty, errorView, esc, filters, link, money, pagination, table } from '../shared/ui.js';
import { pageState, session } from '../shared/state.js';
import { api } from '../shared/api.js';

export async function auditPage(ticket) {
    const name = "audit",
        s = pageState(name),
        id =
            session.actor.role === "client"
                ? session.actor.id
                : session.currentRoute.q.get("clientId") || s.filters.clientId || 1;
    filters(
        `${session.actor.role === "admin" ? `<label>Client ID<input type="number" name="clientId" min="1" required value="${id}"></label>` : ""}<label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label><button>Apply dates</button>`,
        name,
    );
    if (session.actor.role === "admin" && session.currentRoute.q.get("clientId"))
        $("#filters").elements.clientId.value = id;
    const q = new URLSearchParams({ ...s.filters, page: s.page, limit: 10 });
    const results = await Promise.allSettled([
        api(`clients/${id}`),
        api(`clients/${id}/audit?${q}`),
    ]);
    if (ticket !== session.generation) return;
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
                      session.actor.role === "admin"
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

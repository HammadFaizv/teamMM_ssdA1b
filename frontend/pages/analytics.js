import { render } from '../shared/render.js';
import { $, notice, date, empty, esc, link, money, pagination, table } from '../shared/ui.js';
import { pageState, session } from '../shared/state.js';
import { api } from '../shared/api.js';
import { selectFreelancer } from '../shared/components.js';

export async function analytics(ticket) {
    const name = "analytics", s = pageState(name);
    let id = session.actor.role === "freelancer" ? session.actor.id : session.currentRoute.q.get("freelancerId") || s.filters.freelancerId;
    id=await selectFreelancer(ticket,name,id);
    if(ticket!==session.generation||!id)return;
    const [series, earnings, ranks] = await Promise.all([
        api(`analytics/revenue?freelancerId=${id}`),
        api(`analytics/lifetime-earnings?freelancerId=${id}`),
        api(`analytics/rankings?freelancerId=${id}&page=${s.page}&limit=10`),
    ]);
    if (ticket !== session.generation) return;
    const summary = earnings.data.find((r) => r.freelancer_id === Number(id));
    const max = Math.max(1, ...series.data.map((r) => r.moving_average));
    const points = series.data
        .map(
            (r, i) =>
                `${40 + (i * 620) / Math.max(1, series.data.length - 1)},${170 - (r.moving_average / max) * 140}`,
        )
        .join(" ");
    $("#content").innerHTML =
        `<div class="cards"><div class="card"><h3>${esc(summary?.name || session.actor.name || "Freelancer")} · Seven-day revenue average</h3>${series.data.length ? `<svg viewBox="0 0 700 210" role="img" aria-label="Seven day moving average of revenue"><line x1="40" y1="170" x2="660" y2="170" stroke="#0d0d0d33"/><polyline points="${points}" fill="none" stroke="#f2336b" stroke-width="3"/>${series.data.map((r, i) => `<circle cx="${40 + (i * 620) / Math.max(1, series.data.length - 1)}" cy="${170 - (r.moving_average / max) * 140}" r="4" fill="#0d0d0d"><title>${esc(r.date)}: ${money(r.moving_average)}</title></circle>`).join("")}<text x="40" y="195" class="chart-label">${esc(series.data[0].date)}</text><text x="560" y="195" class="chart-label">${esc(series.data.at(-1).date)}</text></svg>` : "<p>No completed revenue yet.</p>"}<p>${esc(series.measure)}</p></div><div class="card"><h3>${esc(summary?.name || "Worker")} · Lifetime summary</h3><h1>${money(summary?.total || 0)}</h1><p>${summary?.completed || 0} completed contracts<br>Snapshot refreshed: ${earnings.lastRefreshed ? esc(date(earnings.lastRefreshed)) : "Not refreshed yet"}</p><p>Stored lifetime totals can lag contract changes. Refresh earnings to rebuild the summary.</p><button class="secondary" id="refresh-earnings">Refresh earnings</button></div></div><div class="section-caption"><h3>Dense ranking · All platform freelancers</h3><p>Compares all platform freelancers with completed revenue, not just those a client has worked with. ${session.actor.role === "freelancer" ? "Only your own global rank is shown. " : ""}${esc(ranks.measure)} · ties share a rank.</p></div>${
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


export async function refreshEarnings(refreshButton) {
        if (session.pending) return;
        session.pending = true; refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing earnings…";
        $("#actor-switch").disabled = true;
        try {
            await api("analytics/lifetime-earnings/refresh", {method: "POST", body: "{}"});
            notice("Lifetime earnings refreshed successfully.");
            render();
        } catch (error) { notice(error.message, true); }
        finally {
            session.pending = false; $("#actor-switch").disabled = false;
            if (document.contains(refreshButton)) { refreshButton.disabled = false; refreshButton.textContent = "Refresh earnings"; }
        }

}

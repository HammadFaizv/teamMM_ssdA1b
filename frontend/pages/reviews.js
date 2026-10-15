import { $, date, empty, esc, pagination, table } from '../shared/ui.js';
import { pageState, session } from '../shared/state.js';
import { api } from '../shared/api.js';
import { bars, portfolio, selectFreelancer } from '../shared/components.js';

export async function reviewsPage(ticket) {
    const s=pageState("reviews");
    let id=session.actor.role==='freelancer'?session.actor.id:session.currentRoute.q.get('freelancerId')||s.filters.freelancerId;
    id=await selectFreelancer(ticket,'reviews',id);
    if(ticket!==session.generation||!id)return;
    const [p, r, entries] = await Promise.all([
        api(`freelancers/${id}/portfolio`),
        api(`reviews/analytics?freelancerId=${id}`),
        api(`reviews?freelancerId=${id}&page=${s.page}&limit=10`),
    ]);
    if (ticket !== session.generation) return;
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

import { $, empty, errorView, esc, notice } from './ui.js';
import { LOADING_QUOTES, editorial, pick, publicNames } from './editorial.js';
import { allowed, route } from './router.js';
import { header, stats } from './layout.js';
import { browse } from '../pages/browse.js';
import { clientDetails, contractDetails, workerDetails } from '../pages/details.js';
import { fund } from '../pages/fund.js';
import { auditPage } from '../pages/audit.js';
import { analytics } from '../pages/analytics.js';
import { nearby } from '../pages/nearby.js';
import { reviewsPage } from '../pages/reviews.js';
import { openActor } from './actors.js';
import { session } from './state.js';

export async function render() {
    if($("#map-dialog").open)$("#map-dialog").close();
    const ticket = ++session.generation;
    clearInterval(session.poll);
    session.poll = null;
    session.currentRoute = route();
    header();
    editorial(session.actor ? session.currentRoute.name : "welcome");
    $("#title").textContent = publicNames[session.currentRoute.name];
    $("#breadcrumb").textContent = publicNames[session.currentRoute.name];
    $("#panel-title").textContent = publicNames[session.currentRoute.name];
    $("#panel-description").textContent = "";
    $("#tabs").innerHTML = "";
    $("#filters").innerHTML = "";
    $("#pagination").innerHTML = "";
    $("#stats").innerHTML = "";
    if (!session.actor) {
        $("#title").textContent = "Welcome to GigTask";
        $("#content").innerHTML = empty(
            "Choose a role and seeded actor to enter your workspace.",
            '<button class="primary" data-choose-actor>Choose demo actor</button>',
        );
        openActor();
        return;
    }
    if (!allowed(session.currentRoute.name)) {
        $("#content").innerHTML = errorView(
            new Error(
                "Access denied. This page is not available for the selected role.",
            ),
        );
        return;
    }
    $("#content").innerHTML =
        `<div class="message">Loading your workspace…<span class="quote">${esc(pick(LOADING_QUOTES, session.currentRoute.name))}</span></div>`;
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
        await handlers[session.currentRoute.name](ticket);
        if (session.currentRoute.name === "nearby" && ticket === session.generation)
            session.poll = setInterval(() => {
                if (!document.hidden && !session.pending) nearby(ticket, true);
            }, 15000);
    } catch (e) {
        if (ticket === session.generation) {
            $("#content").innerHTML = errorView(e);
            if (e.status === 401)
                notice(
                    "Your saved demo actor is unavailable. Choose an actor again.",
                    true,
                );
        }
    }
}

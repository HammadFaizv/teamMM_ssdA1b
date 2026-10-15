import { refreshEarnings } from '../pages/analytics.js';
import { updateContractStatus } from '../pages/details.js';
import { $ } from './ui.js';
import { pageState, persist, session } from './state.js';
import { go, route } from './router.js';
import { browseEntity } from '../pages/browse.js';
import { render } from './render.js';
import { openActor } from './actors.js';

export function initEvents() {
    $("#filters").onsubmit = (e) => {
        e.preventDefault();
        const name =
            session.currentRoute.name === "browse"
                ? "browse-" + browseEntity()
                : session.currentRoute.name;
        pageState(name).filters = Object.fromEntries(new FormData(e.currentTarget));
        pageState(name).page = 1;
        persist();
        if (
            ["analytics", "reviews", "audit"].includes(session.currentRoute.name) &&
            session.currentRoute.q.toString()
        )
            go(session.currentRoute.name);
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
        if (!session.pending) render();
    };
    document.addEventListener("click", async (e) => {
        if (e.target.closest("[data-demo-location]")) {
            const s=pageState("nearby");
            s.filters={lat:"17.45452",lng:"78.35008"};
            s.source="Seeded Hyderabad demo location (not browser GPS)";s.accuracy=null;s.page=1;persist();render();return;
        }

        if (e.target.closest("[data-retry]")) {
            if (!session.pending) render();
            return;
        }
        if (e.target.closest("[data-choose-actor]")) {
            openActor();
            return;
        }
        const refreshButton = e.target.closest("#refresh-earnings");
        if (refreshButton) {
            await refreshEarnings(refreshButton);
            return;
        }
        const b = e.target.closest("#status-action");
        await updateContractStatus(b);
    });
    window.addEventListener("hashchange", () => {
        if (session.pending) {
            history.replaceState(null, "", session.lastHash);
            return;
        }
        if (session.dirty && session.currentRoute?.name === "fund" && route().name !== "fund") {
            if (!confirm("Leave this funding form and discard your changes?")) {
                history.replaceState(null, "", session.lastHash);
                return;
            }
            session.dirty = false;
            session.draft = null;
        }
        session.lastHash = location.hash;
        render();
    });
    window.addEventListener("beforeunload", (e) => {
        if (session.dirty || session.pending) {
            e.preventDefault();
            e.returnValue = "";
        }
    });
}


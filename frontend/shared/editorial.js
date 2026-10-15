import { $ } from './ui.js';

export const publicNames = {
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

export const hl = (text) => `<span class="hl"><b><i>${text}</i></b></span>`;

export const QUOTES = {
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

export const EMPTY_QUOTES = [
    "Every big gig starts with an empty page.",
    "No work here yet. That is room for the next one.",
    "A quiet list is just a gig waiting to be funded.",
    "Even the longest task list started with nothing.",
    "Nothing to show yet. Good work takes a moment.",
];

export const LOADING_QUOTES = [
    "Good work takes a moment.",
    "Great gigs are worth the wait.",
    "Gathering the work, one task at a time.",
];

export const pick = (list, text) =>
    list[[...String(text)].reduce((n, c) => n + c.charCodeAt(0), 0) % list.length];

export function editorial(name) {
    const q = QUOTES[name] || QUOTES.welcome;
    $("#statement").innerHTML = q.statement;
    $("#closing").innerHTML = q.closing;
    $("#subtitle").textContent = q.tagline;
    $("#fact-scope").textContent = name === "welcome" ? "Welcome" : publicNames[name];
    $("#fact-year").textContent = String(new Date().getFullYear());
}

import { readStorage, saveStorage } from './storage.js';

// Shared mutable state lets page modules observe the latest actor and navigation ticket.
const savedActor = readStorage('gigtask.actor', null);
export const session = {
    actor: savedActor && ['client', 'freelancer', 'admin'].includes(savedActor.role)
        && (savedActor.role === 'admin' || Number.isInteger(savedActor.id)) ? savedActor : null,
    pages: readStorage('gigtask.pages', {}),
    generation: 0, pending: false, dirty: false, poll: null,
    currentRoute: null, draft: null,
    actorPage: 1, actorGeneration: 0, actorTotalPages: 1,
    mapResults: null, mapView: null, locating: false,
    lastHash: location.hash || '#browse',
};

export function pageState(name) {
    return (session.pages[name] ||= { page: 1, filters: {} });
}

export function persist() {
    saveStorage('gigtask.pages', session.pages);
}

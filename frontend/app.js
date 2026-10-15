import { initActorEvents } from './shared/actors.js';
import { initEvents } from './shared/events.js';
import { initMapEvents } from './shared/map.js';
import { render } from './shared/render.js';

// Modules are loaded before event handlers are registered and the first page renders.
initActorEvents();
initEvents();
initMapEvents();
render();

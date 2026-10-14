# GigTask frontend

Plain browser HTML/CSS/JS, served independently of the API. Requires Node.js 22.13+ for the supplied development server; no package installation/build step.

```bash
cp .env.example .env
npm start
```

Open http://localhost:5173. `FRONTEND_API_URL` controls the API URL, default `http://localhost:3000/api`. `/config.js` exposes this public setting as `window.GIGTASK_CONFIG.apiBaseUrl`; `app.js` uses it for every request. Change the value and restart this server to point at a remotely deployed API. The API must allow this frontend origin through backend `CORS_ORIGIN`.

Do not put PostgreSQL or MongoDB URLs/credentials here. The browser talks only to HTTP APIs. Demo actor context is stored locally and sent through the demo role headers; no real login is implied.

To serve these files through another static host, provide `/config.js` with:

```js
window.GIGTASK_CONFIG = { apiBaseUrl: 'https://your-api.example/api' };
```

Maintain the script order: config.js before app.js. If config is absent, app.js defaults to same-origin `/api` for deployments using a reverse proxy.

Client/freelancer/admin navigation, funding and status flows, details, audit, analytics, reviews, portfolios and map discovery are retained. Analytics now includes an explicit **Refresh earnings** action for the PostgreSQL materialized view. Network errors keep form input and offer retries. Optional fonts and OpenStreetMap tiles need external network access; the worker results list remains usable without map tiles.

Discovery uses a **Use my location** button, not manual coordinate inputs. Allow location when the browser asks; enable the device's location service if necessary. Existing browser permission can be reused automatically. Location requires HTTPS or localhost. Denied permission or failed lookup offers retry and an explicitly labelled Hyderabad demo origin. Nearby workers appear first in a paginated distance-sorted list; the map is expandable and shows the current result page. Actual browser GPS is never silently replaced by seeded coordinates.

The nearby-worker map opens in a large responsive popup. Drag to pan, use +/− to zoom, and use Back to my location to recenter. Keyboard users can pan with arrow keys and zoom with +/−. Close with the close button, Escape or a backdrop click. Worker markers open their profiles. The map displays workers on the current list page and retains its pan/zoom during automatic result refreshes.

The popup map is square. Its initial zoom fits the farthest worker on the current result page plus a **0.5 km margin** around the origin (rounded to the tile provider's zoom levels). It requests only tiles intersecting the visible square and reuses existing tile images during redraws to reduce loading and flicker. Zooming out beyond the initial fitted scale is disabled; panning and zooming in remain available.

The interface uses a GitHub-inspired light blue palette: blue primary controls and chart lines, pale blue selected navigation and badges, neutral gray surfaces/borders, and visible blue focus rings. Warning/error colors remain distinct. Worker markers are blue and the client's location is purple.

The current visual theme is inspired by Blinkit's yellow-and-green palette, replacing the previous blue theme: a yellow gradient page banner, green gradient primary buttons, yellow secondary actions, pastel statistic cards and rounded list rows. Freelancer browsing uses a responsive profile-card grid instead of a table. Financial tables retain accessible table semantics. Error states remain distinct, and reduced-motion preferences disable decorative hover movement.

The current layout follows the supplied visual reference: an ivory page inside a muted gray surround, horizontal navigation instead of a fixed sidebar, an asymmetric sage hero with a locally rendered botanical SVG poster, condensed display headings, a small yellow callout and restrained yellow accents. Cards and data surfaces use warm neutral tones. This replaces the earlier brand-inspired colour experiments; all application routes and API behavior are retained. The illustration is inline SVG and adds no external image-loading dependency.

The active appearance has been reverted to the FedEx-inspired deep blue/indigo and orange gradient theme, with the original sidebar workspace layout, compact hero banner, pastel summary cards and freelancer profile grid. The reference-inspired split hero and horizontal navigation have been removed. The tagline remains “The World's Work Marketplace”; all functional improvements, including name selectors and the square map popup, are preserved.

## Editorial theme — 14 October 2026

The active appearance follows the supplied "Monolith" reference and replaces the earlier themes described above, then was simplified. It fills the whole window on a flat off-white background, in black Inter type with hot pink and acid lime used sparingly. From the top: a slim full-width pink strip with the GigTask wordmark and a lime edge, then a small uppercase navigation bar (brand, six page links spread across, actor switch) that stays fixed to the top of the window while scrolling, a breadcrumb line, a very large light page title with a short right-aligned description, a facts column (actor, role, scope, year) beside a statement paragraph with a lime highlighter underline on its key phrase, summary figures between hairlines, the data panel, and a closing line. Tables are hairline rows with plain underlined links, buttons are square (black for the main action, outlined otherwise), cards and freelancer tiles have hairline borders, and map markers are black.

Every page has its own tagline, statement and closing line (`QUOTES` in `app.js`), and empty, loading and error states carry a short GigTask-themed quote. All of it is static text. Decoration is CSS only, so the frontend server still serves only `index.html`, `app.js` and `styles.css`. Element ids, routes and API behaviour are unchanged, and the browser smoke test passes against it.

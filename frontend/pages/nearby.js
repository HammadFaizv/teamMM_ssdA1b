import { $, date, empty, esc, link, pagination, person, table } from '../shared/ui.js';
import { pageState, persist, session } from '../shared/state.js';
import { render } from '../shared/render.js';
import { api } from '../shared/api.js';
import { drawLargeMap, openLargeMap } from '../shared/map.js';

export async function browserLocation(ticket) {
    if (session.locating) return;
    const feedback = $("#location-feedback");
    if (!navigator.geolocation || !window.isSecureContext) {
        feedback.innerHTML = 'Browser location requires HTTPS or localhost. <button class="secondary" data-demo-location>Try seeded Hyderabad location</button>';
        return;
    }
    session.locating = true;
    const button = $("#use-location");
    button.disabled = true; button.textContent = "Waiting for location permission…";
    feedback.textContent = "Allow location access in your browser. If asked, enable your device location service.";
    navigator.geolocation.getCurrentPosition(position => {
        session.locating = false;
        if (ticket !== session.generation) return;
        const s = pageState("nearby");
        s.filters = {lat:String(position.coords.latitude),lng:String(position.coords.longitude)};
        s.source = "Browser location"; s.accuracy = position.coords.accuracy; s.page = 1;
        persist(); render();
    }, error => {
        session.locating = false;
        if (ticket !== session.generation) return;
        button.disabled = false; button.textContent = "Use my location";
        const messages = {1:"Location permission was denied. Enable location for this site in browser settings, then retry.",2:"Your device could not find a location. Turn on location services and retry.",3:"Location lookup timed out. Check location services and retry."};
        feedback.innerHTML = `${esc(messages[error.code] || "Could not get location. Please retry.")} <button class="secondary" data-demo-location>Try seeded Hyderabad location</button>`;
    }, {enableHighAccuracy:true,timeout:15000,maximumAge:60000});
}

export async function nearby(ticket, background = false) {
    const s = pageState("nearby");
    if (!background) {
        $("#filters").innerHTML = '<button type="button" id="use-location">Use my location</button><span id="location-feedback" role="status"></span>';
        $("#use-location").onclick = () => browserLocation(ticket);
    }
    if (s.filters.lat === undefined || s.filters.lng === undefined) {
        $("#content").innerHTML = empty("Share your location to find available workers within 5 km.", "Click Use my location and allow the browser permission prompt. Demo workers are based in Hyderabad (17.45452, 78.35008).");
        // Reuse an existing grant automatically; never force a permission prompt on page entry.
        if (navigator.permissions && navigator.geolocation) {
            navigator.permissions.query({name:"geolocation"}).then(permission => {
                if (permission.state === "granted" && ticket === session.generation) browserLocation(ticket);
            }).catch(() => {});
        }
        return;
    }
    if (background && $("#map-freshness")) $("#map-freshness").textContent = "Refreshing nearby workers…";
    try {
        const r = await api("workers/nearby?" + new URLSearchParams({...s.filters,page:s.page,limit:10}));
        if (ticket !== session.generation) return;
        const source = s.source || "Browser location";
        session.mapResults={lat:Number(s.filters.lat),lng:Number(s.filters.lng),workers:r.data};
        $("#content").innerHTML = `<div class="balance-strip"><strong>${esc(source)}</strong> · ${Number(s.filters.lat).toFixed(5)}, ${Number(s.filters.lng).toFixed(5)}${s.accuracy ? ` · accuracy approximately ${Math.round(s.accuracy)} m` : ""}<br>${r.total ?? r.data.length} available workers within 5 km. Distances are measured from your selected location.</div>` +
        (r.data.length ? table(["Worker","Distance from you","Location updated",""],r.data.map(f=>[person(f),(f.distance_meters/1000).toFixed(2)+" km",esc(date(f.location_updated_at)),`${link(`worker?id=${f.id}&from=nearby`,"View profile")} ${session.actor.role==="client"?link(`fund?freelancerId=${f.id}`,"Choose worker"):""}`])) : empty("No available workers within 5 km of your location.", 'Demo records are in Hyderabad. <button class="secondary" data-demo-location>Try seeded Hyderabad location</button>')) +
        `<div class="map-section"><p id="map-freshness">Updated ${esc(new Date().toLocaleTimeString())} · Polls every 15 seconds · Current origin marked ◎.</p><button type="button" class="secondary" id="open-map">⤢ Open large map</button></div>`;
        $("#open-map").onclick=openLargeMap;
        if($("#map-dialog").open)drawLargeMap();
        if (r.total !== undefined) pagination(r,"nearby");
        document.querySelectorAll(".map-tile").forEach(img=>img.onerror=()=>{const note=$("#map-fallback");if(note)note.hidden=false;});
    } catch(error) {
        if(ticket!==session.generation)return;
        if(background&&$("#map-freshness"))$("#map-freshness").innerHTML=`${esc(error.message)} <button data-retry class="secondary">Retry</button>`;
        else throw error;
    }
}

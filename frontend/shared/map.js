import { $, esc } from './ui.js';
import { session } from './state.js';

export function project(lat, lng, zoom = 12) {
    const size = 256 * 2 ** zoom,
        sin = Math.sin((lat * Math.PI) / 180);
    return {
        x: ((lng + 180) / 360) * size,
        y:
            (0.5 -
                Math.log(
                    (1 + Math.min(0.9999, Math.max(-0.9999, sin))) /
                        (1 - Math.min(0.9999, Math.max(-0.9999, sin))),
                ) /
                    (4 * Math.PI)) *
            size,
    };
}

export function mapHTML(lat, lng, workers, options = {}) {
    const zoom=options.zoom || 12, center=options.center || project(Math.max(-85, Math.min(85, lat)),lng,zoom), width=options.width || 640, height=options.height || 340;
    const origin=project(Math.max(-85,Math.min(85,lat)),lng,zoom);
    const count=2**zoom;
    const left=Math.floor((center.x-width/2)/256),right=Math.floor((center.x+width/2-1)/256);
    const top=Math.floor((center.y-height/2)/256),bottom=Math.floor((center.y+height/2-1)/256);
    let tiles="";
    for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++){
        if(y<0||y>=count)continue;
        tiles+=`<img class="map-tile" alt="" decoding="async" src="https://tile.openstreetmap.org/${zoom}/${((x%count)+count)%count}/${y}.png" style="left:${x*256-center.x+width/2}px;top:${y*256-center.y+height/2}px">`;
    }
    return `<div class="map-frame"><div class="map-canvas" style="width:${width}px;height:${height}px" role="region" aria-label="Map showing the job site and available workers">${tiles}<span class="origin-marker" style="left:${origin.x-center.x+width/2}px;top:${origin.y-center.y+height/2}px" title="Your selected location">◎</span>${workers
        .map((f, i) => {
            const p = project(f.latitude, f.longitude,zoom);
            return `<a class="worker-marker" style="left:${p.x - center.x + width/2}px;top:${p.y - center.y + height/2}px" href="#worker?id=${f.id}&from=nearby" aria-label="${esc(f.name)} ${(f.distance_meters / 1000).toFixed(2)} km away">${i + 1}</a>`;
        })
        .join(
            "",
        )}</div><div id="map-fallback" class="map-fallback" hidden>Map tiles unavailable. Use the distance-sorted list below.</div><a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></div>`;
}

export function drawLargeMap(){
    const viewport=$("#map-viewport");if(!viewport||!session.mapView||!session.mapResults)return;
    const cached=new Map([...viewport.querySelectorAll('.map-tile')].map(img=>[img.src,img]));
    const template=document.createElement('template');
    template.innerHTML=mapHTML(session.mapResults.lat,session.mapResults.lng,session.mapResults.workers,{...session.mapView,width:viewport.clientWidth,height:viewport.clientHeight});
    template.content.querySelectorAll('.map-tile').forEach(img=>{const previous=cached.get(img.src);if(previous){previous.style.cssText=img.style.cssText;img.replaceWith(previous);}});
    viewport.replaceChildren(template.content);
    viewport.querySelectorAll('.map-tile').forEach(img=>img.onerror=()=>{const note=$("#map-fallback");if(note)note.hidden=false;});
}

export function openLargeMap(){
    if(!session.mapResults)return;
    const dialog=$("#map-dialog");
    dialog.innerHTML='<div class="dialog-heading"><div><h2 id="map-heading">Nearby workers</h2><p>Drag to pan · use + / − to zoom · ◎ your location · numbered markers are workers on this page</p></div><button id="close-map" class="secondary" aria-label="Close map">✕</button></div><div class="map-toolbar"><button id="map-zoom-in" class="secondary" aria-label="Zoom in">+</button><button id="map-zoom-out" class="secondary" aria-label="Zoom out">−</button><button id="map-recenter" class="secondary">Back to my location</button></div><div id="map-viewport" tabindex="0" aria-label="Interactive nearby worker map. Arrow keys pan, plus and minus zoom."></div>';
    dialog.showModal();
    const radius=Math.max(0,...session.mapResults.workers.map(worker=>worker.distance_meters))+500;
    const side=$("#map-viewport").clientWidth;
    const initialZoom=Math.max(0,Math.min(17,Math.floor(Math.log2(156543.03392*Math.cos(session.mapResults.lat*Math.PI/180)*side/(2*radius)))));
    session.mapView={zoom:initialZoom,minZoom:initialZoom,center:project(session.mapResults.lat,session.mapResults.lng,initialZoom)};
    drawLargeMap();
    $("#close-map").onclick=()=>dialog.close();
    function zoom(delta){const next=Math.max(session.mapView.minZoom,Math.min(17,session.mapView.zoom+delta));const scale=2**(next-session.mapView.zoom);session.mapView.center={x:session.mapView.center.x*scale,y:session.mapView.center.y*scale};session.mapView.zoom=next;drawLargeMap();}
    $("#map-zoom-in").onclick=()=>zoom(1);$("#map-zoom-out").onclick=()=>zoom(-1);
    $("#map-recenter").onclick=()=>{session.mapView.center=project(session.mapResults.lat,session.mapResults.lng,session.mapView.zoom);drawLargeMap();};
    const viewport=$("#map-viewport");let drag=null,moved=false;
    viewport.onpointerdown=event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,center:{...session.mapView.center}};moved=false;if(!event.target.closest('a'))viewport.setPointerCapture(event.pointerId);};
    viewport.onpointermove=event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;if(moved){session.mapView.center={x:drag.center.x-dx,y:drag.center.y-dy};drawLargeMap();}};
    viewport.onpointerup=viewport.onpointercancel=()=>{drag=null;};
    viewport.addEventListener('click',event=>{if(moved){event.preventDefault();event.stopPropagation();moved=false;}else if(event.target.closest('.worker-marker'))dialog.close();},true);
    viewport.onkeydown=event=>{const offsets={ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]};if(offsets[event.key]){event.preventDefault();const [x,y]=offsets[event.key];session.mapView.center.x+=x;session.mapView.center.y+=y;drawLargeMap();}else if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?-1:1);}};
    dialog.onclick=event=>{if(event.target===dialog)dialog.close();};
}

export function initMapEvents() {
    window.addEventListener('resize',()=>{if($("#map-dialog").open)drawLargeMap();});
}


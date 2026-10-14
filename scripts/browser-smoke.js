// Optional local Chrome smoke test, no npm dependencies. Uses the Chrome DevTools protocol.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createApplication as createDemoApplication } from "../backend/demo/server.js";
import { createFrontendServer } from "../frontend/server.js";
const dir = await mkdtemp(join(tmpdir(), "gigtask-browser-"));
const real=Boolean(process.env.TEST_DATABASE_URL&&process.env.TEST_MONGODB_URI);
let server, cleanup, fixtureWorkerId=3;
const allowedOrigins=['http://localhost:5173','http://127.0.0.1:5173'];
if(process.env.GIGTASK_E2E_LIVE==='1'){
 process.loadEnvFile(new URL('../backend/.env',import.meta.url));
 const {loadConfig}=await import('../backend/src/config.js');
 const {createConnections}=await import('../backend/src/connections.js');
 const {createApplication}=await import('../backend/src/server.js');
 const config=loadConfig();config.origins=allowedOrigins;
 const connections=createConnections(config);
 fixtureWorkerId=(await connections.pool.query("SELECT f.id FROM freelancers f WHERE f.id<=10 AND f.is_available AND NOT EXISTS(SELECT 1 FROM contracts c WHERE c.freelancer_id=f.id AND c.status='IN_PROGRESS') ORDER BY f.id LIMIT 1")).rows[0]?.id;
 if(!fixtureWorkerId)throw new Error('No available demo worker among the first ten is free of active contracts.');
 ({server}=createApplication({config,connections}));
 cleanup=connections.close;
}else if(real){
 const {default:pg}=await import('../backend/node_modules/pg/lib/index.js');
 const {MongoClient}=await import('../backend/node_modules/mongodb/lib/index.js');
 const {createApplication}=await import('../backend/src/server.js');
 const {migratePostgres,migrateMongo}=await import('../backend/scripts/migrate.js');
 const {seedLinked}=await import('../backend/scripts/seed-linked.js');
 const schema=`gigtask_browser_${process.pid}_${Date.now()}`;
 const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema},pg_catalog -c timezone=UTC`});
 const mongoClient=new MongoClient(process.env.TEST_MONGODB_URI),mongo=mongoClient.db(schema);
 await migratePostgres(pool);await migrateMongo(mongo);await seedLinked({pool,mongo});
 ({server}=createApplication({config:{origins:allowedOrigins},connections:{pool,mongo,close:async()=>{}}}));
 cleanup=async()=>{await pool.end();await mongo.dropDatabase();await mongoClient.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};
}else{
 const app=createDemoApplication({databasePath:':memory:'});server=app.server;cleanup=async()=>app.db.close();
}
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const apiBase=`http://127.0.0.1:${server.address().port}/api`;
const frontend=createFrontendServer({apiBaseUrl:apiBase});
await new Promise(resolve=>frontend.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${frontend.address().port}`;
allowedOrigins.push(base);
// SQLite demo uses an environment allowlist; real API uses the same shared origins array.
process.env.CORS_ORIGIN=allowedOrigins.join(',');
const chrome = spawn(
    process.env.CHROME_BIN || "/usr/bin/google-chrome",
    [
        "--headless",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--remote-debugging-port=0",
        `--user-data-dir=${dir}`,
        "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
    const debuggerURL = await new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
            () =>
                reject(
                    new Error(
                        "Chrome did not start. Set CHROME_BIN to your local Chrome binary.",
                    ),
                ),
            15000,
        );
        chrome.on("error", reject);
        chrome.stderr.on("data", (chunk) => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]);
            }
        });
    });
    const port = new URL(debuggerURL).port;
    const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    ws = new WebSocket(
        targets.find((t) => t.type === "page").webSocketDebuggerUrl,
    );
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    let sequence = 0;
    const callbacks = new Map(),
        exceptions = [];
    ws.onmessage = (event) => {
        const result = JSON.parse(event.data);
        if (result.id) {
            const callback = callbacks.get(result.id);
            callbacks.delete(result.id);
            result.error
                ? callback.reject(new Error(result.error.message))
                : callback.resolve(result.result);
        } else if (result.method === "Runtime.exceptionThrown")
            exceptions.push(
                result.params.exceptionDetails.text +
                    " " +
                    (result.params.exceptionDetails.exception?.description ||
                        ""),
            );
        else if (result.method === "Page.javascriptDialogOpening")
            command("Page.handleJavaScriptDialog", { accept: true }).catch(
                () => {},
            );
    };
    function command(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            callbacks.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const r = await command("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (r.exceptionDetails)
            throw new Error(
                r.exceptionDetails.exception?.description ||
                    r.exceptionDetails.text,
            );
        return r.result.value;
    }
    async function until(expression, label, attempts = 200) {
        for (let i = 0; i < attempts; i++) {
            if (await evaluate(expression)) return;
            await sleep(75);
        }
        throw new Error("Timed out: " + label);
    }
    const click = (selector) =>
        evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    async function input(selector, value, event = "input") {
        await evaluate(
            `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`,
        );
    }
    async function navigate(hash, condition) {
        await evaluate(`location.hash=${JSON.stringify(hash)}`);
        await until(condition, hash);
    }
    async function chooseActor(role, id) {
        await click("#actor-switch");
        await input("#actor-role", role, "change");
        if (role !== "admin") {
            await until(
                `document.querySelector('#actor-id option[value="${id}"]')`,
                "actors loaded",
            );
            await input("#actor-id", String(id), "change");
        }
        await click("#actor-continue");
        await until(
            `!document.querySelector('#actor-dialog').open && document.querySelector('#content table')`,
            "actor workspace",
        );
    }
    await command("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await command("Runtime.enable");
    await command("Page.enable");
    await command("Page.navigate", { url: base });
    await until(`document.querySelector('#actor-dialog')?.open`, "actor entry");
    await input("#actor-role", "client", "change");
    await until(
        `document.querySelector('#actor-id option[value="1"]')`,
        "client list",
    );
    await input("#actor-id", "1", "change");
    await click("#actor-continue");
    await until(`document.querySelector('#content table')`, "client browse");
    assert.match(
        await evaluate(`document.querySelector('#actor-switch').textContent`),
        /Client/,
    );
    await navigate(
        `worker?id=${fixtureWorkerId}`,
        `document.querySelector('#content').textContent.includes('Fund gig with this worker')`,
    );
    await click(`a[href="#fund?freelancerId=${fixtureWorkerId}"]`);
    await until(`document.querySelector('#fund-form')`, "prefilled fund");
    assert.equal(
        await evaluate(`document.querySelector('#fund-worker').value`),
        String(fixtureWorkerId),
    );
    await input("#fund-budget", "99999");
    await click("#fund-submit");
    await until(
        `document.querySelector('#fund-error')?.textContent.includes('Insufficient balance')`,
        "insufficient funds",
    );
    assert.equal(
        await evaluate(`document.querySelector('#fund-budget').value`),
        "99999",
    );
    await input("#fund-budget", "25.50");
    await click("#fund-submit");
    await until(
        `location.hash.startsWith('#contract?id=') && document.querySelector('#status-action')`,
        "funding redirect",
    );
    const first = await evaluate(
        `new URLSearchParams(location.hash.split('?')[1]).get('id')`,
    );
    assert.match(
        await evaluate(`document.querySelector('#notice').textContent`),
        /Audit entry/,
    );
    await click("#status-action");
    await until(
        `document.querySelector('#status-action')?.textContent==='Mark completed'`,
        "start contract",
    );
    await navigate(
        `fund?freelancerId=${fixtureWorkerId}`,
        `document.querySelector('#fund-form')`,
    );
    await input("#fund-budget", "12");
    await click("#fund-submit");
    await until(
        `location.hash.startsWith('#contract?id=') && document.querySelector('#status-action')`,
        "second funding",
    );
    const second = await evaluate(
        `new URLSearchParams(location.hash.split('?')[1]).get('id')`,
    );
    await click("#status-action");
    await until(
        `document.querySelector('#action-error')?.textContent.includes('already has an in progress')`,
        "active conflict",
    );
    await navigate(
        `contract?id=${first}`,
        `document.querySelector('#status-action')?.textContent==='Mark completed'`,
    );
    await click("#status-action");
    await until(
        `document.querySelector('#content').textContent.includes('Completed contract.')`,
        "complete first",
    );
    await navigate(
        `contract?id=${second}`,
        `document.querySelector('#status-action')?.textContent==='Start work'`,
    );
    await click("#status-action");
    await until(
        `document.querySelector('#status-action')?.textContent==='Mark completed'`,
        "start second",
    );
    await chooseActor("freelancer", fixtureWorkerId);
    assert.equal(
        await evaluate(`document.querySelector('nav a[href="#fund"]')===null`),
        true,
    );
    await navigate(
        "audit",
        `document.querySelector('#content').textContent.includes('Access denied')`,
    );
    await chooseActor("admin");
    await navigate(
        `contract?id=${second}`,
        `document.querySelector('#content').textContent.includes('Admin is read only.')`,
    );
    assert.equal(
        await evaluate(`document.querySelector('#status-action')===null`),
        true,
    );
    await navigate(
        "audit?clientId=1",
        `document.querySelector('#content').textContent.includes('Available balance') && document.querySelector('#content table')`,
    );
    assert.match(
        await evaluate(`document.querySelector('#content').textContent`),
        /ESCROW HOLD/,
    );
    await navigate(
        `analytics?freelancerId=${fixtureWorkerId}`,
        `document.querySelector('#content').textContent.includes('Dense ranking')`,
    );
    assert.equal(
        await evaluate(`document.querySelector('#content svg')!==null`),
        true,
    );
    await click('#refresh-earnings');
    await until(`document.querySelector('#notice').textContent.includes('earnings refreshed') && document.querySelector('#refresh-earnings')?.disabled===false`,'earnings refresh control');
    await navigate(
        `reviews?freelancerId=${fixtureWorkerId}`,
        `document.querySelector('#content').textContent.includes('Rating distribution')`,
    );
    assert.match(
        await evaluate(`document.querySelector('#content').textContent`),
        /Certifications/,
    );
    await command("Network.enable");
    await command("Network.setBlockedURLs", {
        urls: ["*tile.openstreetmap.org*"],
    });
    await command('Browser.setPermission',{permission:{name:'geolocation'},setting:'denied',origin:base});
    await navigate('nearby',`document.querySelector('#use-location') && document.querySelector('#content').textContent.includes('Share your location')`);
    await click('#use-location');
    await until(`document.querySelector('#location-feedback').textContent.includes('denied')`,'location denial feedback');
    await command('Browser.setPermission',{permission:{name:'geolocation'},setting:'granted',origin:base});
    await command('Emulation.setGeolocationOverride',{latitude:17.45452,longitude:78.35008,accuracy:20});
    await click('#use-location');
    await until(
        `document.querySelector('#open-map') && document.querySelector('#content table')`,
        "map and distance list",
    );
    await click('#open-map');
    await until(`document.querySelector('#map-dialog').open`,'large map popup');
    const mapWidth=await evaluate(`document.querySelector('#map-viewport').clientWidth`);
    assert.ok(mapWidth>120,'popup fits the available browser height');
    assert.ok(Math.abs(mapWidth-await evaluate(`document.querySelector('#map-viewport').clientHeight`))<=2,'map is square');
    assert.ok(await evaluate(`document.querySelectorAll('#map-viewport .map-tile').length`)<=25,'only visible tiles are requested');
    const initialTile=await evaluate(`document.querySelector('#map-viewport .map-tile').src`);
    await click('#map-zoom-in');
    assert.notEqual(await evaluate(`document.querySelector('#map-viewport .map-tile').src`),initialTile);
    await click('#map-recenter');
    await until(
        `document.querySelector('#map-fallback')?.hidden===false`,
        "map tile failure fallback",
    );
    await click("#close-map");
    assert.equal(await evaluate(`document.querySelector("#map-dialog").open`),false);
    if(process.env.GIGTASK_E2E_LIVE==='1'){
        const workerHref=await evaluate(`document.querySelector('#content table a[href^="#worker?id="]').getAttribute('href')`);
        const workerId=new URLSearchParams(workerHref.split('?')[1]).get('id');
        const headers={'Content-Type':'application/json','X-Demo-Role':'freelancer','X-Demo-Id':workerId};
        const original=(await (await fetch(`${apiBase}/freelancers/${workerId}`,{headers})).json()).data;
        await evaluate('window.__pollCheck="same-document"');
        async function sendPing(lat,lng){
            let result;
            for(let attempt=0;attempt<3;attempt++){
                const response=await fetch(`${apiBase}/workers/${workerId}/location`,{method:'POST',headers,body:JSON.stringify({lat,lng})});
                result={status:response.status,body:await response.json()};
                if(result.status!==503)break;
                await sleep(500);
            }
            assert.equal(result.status,200,result.body.error);return result;
        }

        try{
            await sendPing(0,0);
            await until(`!document.querySelector('#content table a[href="#worker?id=${workerId}&from=nearby"]')`,'new ping reflected by polling without reload',400);
            assert.equal(await evaluate('window.__pollCheck'),'same-document');
        }finally{
            await sendPing(original.latitude,original.longitude);
        }
    }

    await navigate(
        `worker?id=${fixtureWorkerId}&from=nearby`,
        `document.querySelector('#content').textContent.includes('Certifications')`,
    );
    await click('a[href="#nearby"]');
    await until(`document.querySelector('#open-map')`, "map search preserved");
    await command("Page.reload");
    await until(
        `document.querySelector('#open-map') && !document.querySelector('#actor-dialog').open`,
        "actor and map context persisted across reload",
    );
    await navigate(
        "browse?tab=clients",
        `document.querySelector('#content table')`,
    );
    const desktopShot=await command('Page.captureScreenshot',{format:'png'});
    await writeFile('/tmp/gigtask-desktop.png',Buffer.from(desktopShot.data,'base64'));
    await command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
    });
    assert.ok(
        await evaluate(
            "document.documentElement.scrollWidth<=window.innerWidth",
        ),
        "mobile page does not overflow horizontally",
    );
    const shot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(
        "/tmp/gigtask-mobile.png",
        Buffer.from(shot.data, "base64"),
    );
    if(process.env.GIGTASK_E2E_LIVE==='1'){
        const cleanupResponse=await fetch(`${apiBase}/contracts/${second}/status`,{method:'PATCH',headers:{'Content-Type':'application/json','X-Demo-Role':'client','X-Demo-Id':'1'},body:JSON.stringify({status:'COMPLETED'})});
        assert.equal(cleanupResponse.status,200);
    }
    assert.deepEqual(exceptions, []);
    if(process.env.GIGTASK_E2E_LIVE==='1'){
        await mkdir(new URL('../backend/reports/',import.meta.url),{recursive:true});
        await writeFile(new URL('../backend/reports/e2e-live.json',import.meta.url),JSON.stringify({testedAt:new Date().toISOString(),dataset:'configured PostgreSQL/MongoDB scale dataset',passed:true,checks:['demo actor entry','worker profile and prefilled funding','insufficient funds preserves input','funding redirect and audit notice','start contract','second active contract conflict','complete first and start second','freelancer access restrictions','read-only admin','audit history','SQL analytics and materialized refresh','MongoDB reviews and portfolio','geolocation denial/grant','distance list','map popup, zoom, recenter, close and tile fallback','persistent actor/location state','live worker ping appears through polling without page reload','mobile overflow','no JavaScript runtime exceptions'],createdContracts:[first,second],screenshots:['docs/design/desktop.png','docs/design/mobile.png']},null,2));
    }

    console.log(
        "Browser smoke passed (separate frontend/API ports): entry, actor roles, profile prefill, failure preservation, atomic funding redirect, active conflict, completion, admin restrictions, audit, analytics, reviews, map tile fallback, persistent actor/map context and mobile width. Screenshot: /tmp/gigtask-mobile.png",
    );
} finally {
    ws?.close();
    chrome.kill("SIGTERM");
    await new Promise((resolve) => server.close(resolve));
    await new Promise(resolve=>frontend.close(resolve));
    await cleanup();
    await sleep(200);
    await rm(dir, { recursive: true, force: true });
}

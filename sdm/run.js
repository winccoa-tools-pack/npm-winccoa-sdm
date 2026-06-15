// -----------------------------------------------------------------------------
// run.js -- JavaScript Manager entry point for the SDM backend
// -----------------------------------------------------------------------------
// Plain JavaScript (the JavaScript Manager loads it without a build step). It
// imports the compiled TypeScript from dist/ and starts the SDM dashboard
// server, then bootstraps the meta model and keeps the TBox cache fresh.
//
// Build first:  npm run build
// Then add a JavaScript Manager with this file as its parameter: sdm/run.js
//
// This server includes ALL standard dashboard handlers plus the sdm.* commands,
// so it can REPLACE the standard webserver-js manager. By default it behaves
// exactly like the standard webserver: open() with no arguments reads the port
// and WebSocket endpoint from config/config ([webserverjs], httpsPort 8443).
//
// To instead run it ADDITIONALLY alongside the standard webserver, set a
// distinct port/endpoint on the manager via env:
//   SDM_PORT  (e.g. 8444)
//   SDM_WSS   (e.g. '/winccoa')
// -----------------------------------------------------------------------------

const {
  SdmDashboardServer,
  WsjServerGlobal,
  bootstrapSdm,
  loadTBox,
  setManager
} = require('.');

// Safety net only: the TBox cache is refreshed event-driven (see below). This
// interval merely retries bootstrap after a redundancy switchover and resyncs.
const SAFETY_RESYNC_MS = 120000;
const RELOAD_DEBOUNCE_MS = 300;

// Structural sysConnect events that may affect the ontology / instance model.
// (Value changes are intentionally NOT watched here - that would fire on every
// process value update; live values are handled per-subscription in the UI.)
const STRUCTURAL_EVENTS = ['dpCreated', 'dpDeleted', 'dpTypeCreated', 'dpTypeDeleted', 'dpTypeChanged'];

async function runServer() {
  try {
    const server = new SdmDashboardServer();

    // Default: drop-in replacement -> open() reads port/endpoint from config.
    // Optional: run additionally on a distinct port via SDM_PORT / SDM_WSS.
    if (process.env.SDM_PORT) {
      await server.open(Number(process.env.SDM_PORT), process.env.SDM_WSS || '/winccoa');
    } else {
      await server.open();
    }

    // The model uses an injected WinccoaManager — provide the webserver's one.
    setManager(WsjServerGlobal.winccoa);

    // Create meta dpTypes + backbone view (gated to the active redundancy peer),
    // then load the small ontology into the in-memory cache.
    await bootstrapSdm();
    await loadTBox();

    // Event-driven TBox refresh: WinCC OA is online-changeable, so instead of
    // polling we listen to structural sysConnect events. Any data point or
    // dpType created/deleted/changed anywhere (UI, other client, CTRL, PARA, ...)
    // refreshes the cache immediately. Debounced to coalesce bursts. This fires
    // only on structural changes, never on process value updates.
    let reloadTimer = null;
    const scheduleReload = () => {
      if (reloadTimer) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        loadTBox().catch((e) => console.error('SDM TBox reload failed:', e));
      }, RELOAD_DEBOUNCE_MS);
    };
    try {
      const sys = WsjServerGlobal.winccoa.sysConnect;
      for (const ev of STRUCTURAL_EVENTS) sys.on(ev, scheduleReload);
    } catch (e) {
      console.error('SDM structural watch could not be established:', e);
    }

    // Safety net: retry bootstrap after a redundancy switchover and resync.
    const timer = setInterval(() => {
      Promise.resolve()
        .then(bootstrapSdm)
        .then(loadTBox)
        .catch((e) => console.error('SDM safety resync failed:', e));
    }, SAFETY_RESYNC_MS);
    timer.unref && timer.unref();
  } catch (err) {
    console.error(err);
    console.error('Unexpected error (see above) - run.js is exiting');
    WsjServerGlobal.winccoa.exit(1);
  }
}

void runServer();

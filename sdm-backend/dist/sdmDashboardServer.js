"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SdmDashboardServer = void 0;
// -----------------------------------------------------------------------------
// SdmDashboardServer
// -----------------------------------------------------------------------------
// Extends the standard webserver.js dashboard server with the SDM WebSocket
// request handler. It keeps ALL standard handlers (connection, model, dashboard,
// live data, ...) and adds the "sdm." command family on top — so this single
// server can either run additionally on its own port or replace the standard
// webserver manager.
// -----------------------------------------------------------------------------
const webserver_js_1 = require("webserver-js");
const sdmRequestHandler_1 = require("./sdmRequestHandler");
class SdmDashboardServer extends webserver_js_1.WsjDashboardServer {
    /**
     * Registers WebSocket request handlers. Calls super first to keep all
     * standard handlers, then registers the SDM handler (prefix "sdm.").
     */
    registerStandardHandlers() {
        super.registerStandardHandlers();
        webserver_js_1.WsjRequestHandlerRegistry.registerHandler(new sdmRequestHandler_1.SdmRequestHandler());
    }
}
exports.SdmDashboardServer = SdmDashboardServer;
//# sourceMappingURL=sdmDashboardServer.js.map
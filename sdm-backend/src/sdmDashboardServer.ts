// -----------------------------------------------------------------------------
// SdmDashboardServer
// -----------------------------------------------------------------------------
// Extends the standard webserver.js dashboard server with the SDM WebSocket
// request handler. It keeps ALL standard handlers (connection, model, dashboard,
// live data, ...) and adds the "sdm." command family on top — so this single
// server can either run additionally on its own port or replace the standard
// webserver manager.
// -----------------------------------------------------------------------------
import { WsjDashboardServer, WsjRequestHandlerRegistry } from 'webserver-js';
import { SdmRequestHandler } from './sdmRequestHandler';

export class SdmDashboardServer extends WsjDashboardServer {
  /**
   * Registers WebSocket request handlers. Calls super first to keep all
   * standard handlers, then registers the SDM handler (prefix "sdm.").
   */
  protected registerStandardHandlers(): void {
    super.registerStandardHandlers();
    WsjRequestHandlerRegistry.registerHandler(new SdmRequestHandler());
  }
}

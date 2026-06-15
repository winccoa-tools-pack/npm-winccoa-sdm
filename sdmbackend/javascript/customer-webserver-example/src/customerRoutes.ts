// -----------------------------------------------------------------------------
// CustomerRoutes
// -----------------------------------------------------------------------------
// This file demonstrates how to add custom HTTP routes to webserver.js.
//
// webserver.js uses UltimateExpress (an Express-compatible API built on
// uWebSockets.js) for HTTP routing. Custom routes are defined here and
// mounted in CustomerDashboardServer.defineRoutes().
//
// Three types of custom routes are shown:
//
//   1. Static file serving  -- WsjStaticLiveDirectoryRoute serves files from
//      a directory under the WinCC OA project's data/ folder.
//
//   2. TypeScript endpoint   -- A standard Express-style route backed by a
//      TypeScript controller class (ConnectionsRoute / ConnectionsController).
//
//   3. CTRL endpoint         -- WsjCtrlEndpointRoute bridges an HTTP GET
//      request to a CTRL function running in the embedded CTRL manager,
//      allowing endpoints to be implemented in the WinCC OA CTRL language.
//
// Access control:
//   By default, custom routes require authentication. To make routes publicly
//   accessible, set an ACL entry via WsjRoutes.acl.set(). The ACL supports
//   wildcard patterns (e.g. '/customer/*') and provides pre-defined access
//   levels like WsjAccessControlList.fullAccess (no auth required) and
//   WsjAccessControlList.noAccess (always denied).
// -----------------------------------------------------------------------------

import {
  WsjAccessControlList,
  WsjCtrlEndpointRoute,
  WsjRoutes,
  WsjStaticLiveDirectoryRoute
} from '@winccoa/backend';
import { Router } from 'ultimate-express';

import { ConnectionsRoute } from './connectionsRoute';

/**
 * Defines additional customer-specific HTTP routes.
 *
 * Returns an Express Router that is mounted in
 * {@link CustomerDashboardServer.defineRoutes}.
 */
export class CustomerRoutes {
  public static routes() {
    const router = Router();

    // --- Example 1: Static file serving ------------------------------------
    // WsjStaticLiveDirectoryRoute.routes() creates a route that serves files
    // from a directory relative to the WinCC OA project's data/ folder.
    // Here, files placed in <project>/data/customer/data/ will be accessible
    // at http://<host>:<port>/customer/data/<filename>.
    //
    // The "live" in the name means the directory is watched for changes --
    // newly added or modified files are served immediately without restart.
    router.use(WsjStaticLiveDirectoryRoute.routes('/customer/data'));

    // Grant unauthenticated access to all /customer/* routes.
    // Without this, requests would require a valid authentication token.
    // WsjAccessControlList.fullAccess is a pre-defined ACL entry that allows
    // access unconditionally. You can also use more fine-grained options:
    //   { allowUsers: ['root', 'operator'] }  -- restrict to specific users
    //   { allowUsers: '*' }                    -- any authenticated user
    //   WsjAccessControlList.noAccess          -- deny all access
    WsjRoutes.acl.set('/customer/*', WsjAccessControlList.fullAccess);

    // --- Example 2: Dynamic TypeScript route -------------------------------
    // A standard Express-style route backed by a TypeScript controller.
    // ConnectionsRoute creates a sub-router that handles GET requests at
    // /customer/connections and returns data about connected WinCC OA managers
    // in JSON, Markdown, or HTML format (depending on query parameter).
    router.use('/customer/connections', ConnectionsRoute.routes());

    // --- Example 3: CTRL endpoint route ------------------------------------
    // WsjCtrlEndpointRoute.routes() bridges an HTTP request to a CTRL function
    // running in the embedded CTRL manager. The parameters are:
    //   - 'customer'   -- service name, used to identify the CTRL class
    //                     (matched in WsjEmbeddedCtrlUser.callUserHttpEndpoint)
    //   - 'diskFree'   -- function name within that service
    //   - 'text/html'  -- MIME type of the response
    //
    // This means a GET request to /customer/diskfree will execute the
    // CustomerCtrlHttpEndpoints.diskFree() function in CTRL and return
    // the result as HTML.
    //
    // See scripts/libs/classes/wsjServer/CustomerCtrlHttpEndpoints.ctl for
    // the CTRL implementation, and WsjEmbeddedCtrlUser.ctl for the routing.
    router.use(
      '/customer/diskfree',
      WsjCtrlEndpointRoute.routes('customer', 'diskFree', 'text/html')
    );

    return router;
  }
}

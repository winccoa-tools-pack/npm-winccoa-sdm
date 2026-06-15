// -----------------------------------------------------------------------------
// ConnectionsRoute
// -----------------------------------------------------------------------------
// This file shows how to wire an Express-style route to a controller class.
//
// The pattern used here follows a common Express convention:
//   - A "Route" class creates a Router and maps URL paths to controller methods
//   - A "Controller" class contains the actual request handling logic
//
// This separation keeps route definitions concise and controller logic testable.
// The route is mounted in CustomerRoutes at the path "/customer/connections".
// -----------------------------------------------------------------------------

import { Router } from 'ultimate-express';
import { ConnectionsController } from './connectionsController';

/**
 * Route for the connections endpoint.
 *
 * Creates a sub-router that delegates all requests to
 * {@link ConnectionsController.connectionsData}. This route is mounted at
 * "/customer/connections" in {@link CustomerRoutes}, so a GET request to
 * `http://<host>:<port>/customer/connections` will be handled by the
 * controller.
 *
 * Query parameters are forwarded to the controller -- for example:
 *   /customer/connections?format=html
 *   /customer/connections?format=markdown
 *   /customer/connections              (defaults to JSON)
 */
export class ConnectionsRoute {
  /**
   * Creates and returns the Express router for the connections endpoint.
   *
   * @returns Router with the connections endpoint mounted at '/'.
   */
  static routes() {
    const router = Router();
    const controller = new ConnectionsController();

    // Mount the controller's handler at the root of this sub-router.
    // Since this router is mounted at '/customer/connections' by
    // CustomerRoutes, the full URL path is '/customer/connections/'.
    router.use('/', controller.connectionsData);

    return router;
  }
}

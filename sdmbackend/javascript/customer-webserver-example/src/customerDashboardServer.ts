// -----------------------------------------------------------------------------
// CustomerDashboardServer
// -----------------------------------------------------------------------------
// This file shows how to extend the standard webserver.js dashboard server
// with project-specific functionality.
//
// WsjDashboardServer is the main server class provided by the backend package.
// It sets up all standard WebSocket request handlers (for connections, models,
// dashboards, etc.) and all standard HTTP routes (static files, dynamic
// endpoints, etc.).
//
// To add your own functionality you create a subclass and override two
// protected methods:
//
//   - registerStandardHandlers()  -- to add custom WebSocket request handlers
//   - defineRoutes()              -- to add custom HTTP routes
//
// Both methods MUST call their super implementation first so that all standard
// handlers and routes remain available.
//
// The server is a singleton -- only one instance may exist per JavaScript
// Manager.
// -----------------------------------------------------------------------------

import {
  WsjDashboardServer,
  WsjRequestHandlerRegistry
} from '@winccoa/backend';

import { CustomerRoutes } from './customerRoutes';
import { CustomerTsRequestHandler } from './customerTsRequestHandler';

/**
 * Customer-specific sub-class of the dashboard server.
 *
 * This is the central entry point for all customizations. It wires together
 * custom request handlers (for WebSocket commands) and custom HTTP routes.
 *
 * Usage: instantiate this class in run.js and call {@link open}.
 */
export class CustomerDashboardServer extends WsjDashboardServer {
  /**
   * Registers all WebSocket request handlers.
   *
   * The base class registers the standard handlers (connection, core, model,
   * dashboard). This override adds the customer-specific handler so that
   * WebSocket commands prefixed with "customization.example." are routed to
   * {@link CustomerTsRequestHandler}.
   *
   * To add more handlers, call
   * `WsjRequestHandlerRegistry.registerHandler(new YourHandler())` here.
   * Each handler must have a unique {@link WsjRequestHandlerBase.prefix}.
   */
  protected registerStandardHandlers(): void {
    super.registerStandardHandlers();
    WsjRequestHandlerRegistry.registerHandler(new CustomerTsRequestHandler());
  }

  /**
   * Defines HTTP routes served by the Express-compatible application.
   *
   * The base class mounts all standard routes (static file serving, built-in
   * API endpoints, authentication middleware, etc.). This override appends
   * the customer-specific routes defined in {@link CustomerRoutes}.
   *
   * `this.app` is an UltimateExpress application (Express-compatible API on
   * top of uWebSockets.js). Use it exactly like a standard Express app:
   * `this.app!.use(router)`, `this.app!.get(path, handler)`, etc.
   *
   * To add more routes, either extend {@link CustomerRoutes} or mount
   * additional routers here.
   */
  protected defineRoutes() {
    super.defineRoutes();
    this.app!.use(CustomerRoutes.routes());
  }
}

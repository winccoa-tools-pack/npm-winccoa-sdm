// $License: NOLICENSE
//--------------------------------------------------------------------------------
/**
  @file $relPath
  @copyright $copyright
  @author z003yh5a
*/

//--------------------------------------------------------------------------------
// WsjEmbeddedCtrlUser
//--------------------------------------------------------------------------------
// This file is the central registration point for all CTRL-based extensions
// to webserver.js. It contains two hook methods that the framework calls
// automatically:
//
//   1. registerUserHandlers()
//      Called during server startup to register CTRL WebSocket request handlers.
//      This is the CTRL equivalent of CustomerDashboardServer.registerStandardHandlers()
//      in TypeScript.
//
//   2. callUserHttpEndpoint()
//      Called when an HTTP request arrives at a route defined with
//      WsjCtrlEndpointRoute.routes() in TypeScript. This method dispatches
//      the request to the correct CTRL class and method based on the
//      service name and function name configured in the route.
//
// The class name "WsjEmbeddedCtrlUser" is a convention -- the framework
// looks for this class in the project's scripts/ directory.
//
// How the pieces fit together:
//
//   TypeScript side (customerRoutes.ts):
//     router.use('/customer/diskfree',
//       WsjCtrlEndpointRoute.routes('customer', 'diskFree', 'text/html')
//     );
//         |
//         | HTTP GET /customer/diskfree
//         v
//   CTRL side (this file):
//     callUserHttpEndpoint('customer', 'diskFree', ...)
//         |
//         | dispatches based on serviceName + endpointName
//         v
//     CustomerCtrlHttpEndpoints::diskFree(names, values)
//         |
//         | returns dyn_string with HTML body + status
//         v
//   Response sent to client
//--------------------------------------------------------------------------------


//--------------------------------------------------------------------------------
// Libraries used (#uses)
//   WssRequestHandlerRegistry -- the registry where CTRL request handlers
//                                 are registered (same registry used by TypeScript)
//   CustomerCtrlRequestHandler -- example CTRL WebSocket request handler
//   CustomerCtrlHttpEndpoints  -- example CTRL HTTP endpoint implementations
//--------------------------------------------------------------------------------
#uses "classes/wssServer/WssRequestHandlerRegistry"
#uses "classes/wsjServer/CustomerCtrlRequestHandler"
#uses "classes/wsjServer/CustomerCtrlHttpEndpoints"


//--------------------------------------------------------------------------------
/**
  @brief Class that implements project-specific CTRL extensions to webserver.js.

  This class provides hook methods called by the framework to register CTRL
  request handlers and dispatch HTTP requests to CTRL endpoint functions.
*/
class WsjEmbeddedCtrlUser
{
//--------------------------------------------------------------------------------
//@public members
//--------------------------------------------------------------------------------

  //------------------------------------------------------------------------------
  /**
    @brief Register additional CTRL request handlers.

    Called once during server startup. Register each custom CTRL request handler
    by creating an instance and passing it to
    WssRequestHandlerRegistry::registerHandler().

    Each handler's COMMAND_PREFIX must be unique across all registered handlers
    (both CTRL and TypeScript).

    To add more CTRL handlers, create a new class extending
    WssRequestHandlerBase and register it here.
   */
  public static void registerUserHandlers()
  {
    WssRequestHandlerRegistry::registerHandler(new CustomerCtrlRequestHandler());
  }

  //------------------------------------------------------------------------------
  /**
    @brief Dispatches HTTP requests to CTRL endpoint functions.

    Called by the framework when an HTTP request arrives at a route defined
    with WsjCtrlEndpointRoute.routes() in TypeScript. The serviceName and
    endpointName parameters correspond to the first two arguments of
    WsjCtrlEndpointRoute.routes().

    To add new CTRL HTTP endpoints:
      1. Create a CTRL class with a static method matching the endpoint
         signature (see CustomerCtrlHttpEndpoints for the pattern)
      2. Add a route in customerRoutes.ts using WsjCtrlEndpointRoute.routes()
      3. Add a case to the switch statement below to dispatch to your method

    @param serviceName   Name of the service (first arg of WsjCtrlEndpointRoute.routes()).
                         Used to group related endpoints. For example, "customer".
    @param endpointName  Name of the endpoint function (second arg of
                         WsjCtrlEndpointRoute.routes()). For example, "diskFree".
    @param names         List of HTTP query parameter names.
    @param values        List of HTTP query parameter values (parallel array with names).
    @param user          Name of the authenticated user making the request.
    @param ip            IP address of the client.
    @param headerNames   List of HTTP request header names.
    @param headerValues  List of HTTP request header values (parallel array with headerNames).
    @return Result of the request as a dyn_string:
              [1] = response body
              [2] = HTTP status line (e.g. "Status: 200 OK")
              [3+] = additional HTTP response headers (optional)
            Return an empty dyn_string if the serviceName/endpointName
            combination is not recognized -- the framework will return
            a 404 Not Found response.
   */
  public static dyn_string callUserHttpEndpoint(
    string serviceName,
    string endpointName,
    dyn_string names,
    dyn_string values,
    string user,
    string ip,
    dyn_string headerNames,
    dyn_string headerValues)
  {
    // Dispatch based on service name first, then endpoint name.
    // This two-level dispatch allows organizing endpoints into logical
    // groups (services), each potentially implemented by a different
    // CTRL class.
    if (serviceName == "customer")
    {
      switch (endpointName)
      {
        case "diskFree": return CustomerCtrlHttpEndpoints::diskFree(names, values);
        // Add more endpoints for the "customer" service here:
        // case "otherEndpoint": return CustomerCtrlHttpEndpoints::otherEndpoint(names, values);
      }
    }
    // Add more service dispatches here:
    // if (serviceName == "anotherService") { ... }

    // Return empty dyn_string for unknown service/endpoint combinations.
    // The framework will respond with HTTP 404 Not Found.
    return makeDynString();
  }
};

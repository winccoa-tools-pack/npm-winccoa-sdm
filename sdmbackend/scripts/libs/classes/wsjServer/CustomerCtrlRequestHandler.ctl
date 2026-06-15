// $License: NOLICENSE

//--------------------------------------------------------------------------------
/**
  @file $relPath
  @copyright $copyright
  @author Juergen Steiner
*/

//--------------------------------------------------------------------------------
// CustomerCtrlRequestHandler
//--------------------------------------------------------------------------------
// This file demonstrates how to implement a custom WebSocket request handler
// in CTRL (the WinCC OA scripting language).
//
// CTRL request handlers are the CTRL equivalent of TypeScript request handlers
// like CustomerTsRequestHandler.ts. They process WebSocket commands sent by
// WebUI clients, but the implementation runs in the embedded CTRL runtime
// rather than in JavaScript/TypeScript.
//
// To add a CTRL request handler:
//   1. Create a class extending WssRequestHandlerBase (this file)
//   2. Set the COMMAND_PREFIX constant to a unique dot-separated prefix
//   3. Override handleRequest() with a switch on the command name
//   4. Register the handler in WsjEmbeddedCtrlUser.registerUserHandlers()
//
// When a client sends a command like "customization.example.disk.free", the
// framework strips the prefix ("customization.example.") and passes "disk.free"
// to this handler's handleRequest() method.
//--------------------------------------------------------------------------------


//--------------------------------------------------------------------------------
// Libraries used (#uses)
//   WssRequestHandlerBase is the base class for all CTRL request handlers.
//   It provides the handleRequest() method to override and helper methods
//   like checkLastError() and setError() for error handling.
//--------------------------------------------------------------------------------
#uses "classes/wssServer/WssRequestHandlerBase"

//--------------------------------------------------------------------------------
/**
  @brief Example for a project-specific CTRL request handler.

  This handler processes WebSocket commands prefixed with "customization.example."
  and demonstrates:
    - Defining a command prefix
    - Reading WinCC OA data point values with dpGet()
    - Error handling with checkLastError() and setError()
    - Returning data to the client via the result mapping

  The handler is registered in WsjEmbeddedCtrlUser.registerUserHandlers().
 */
class CustomerCtrlRequestHandler : WssRequestHandlerBase
{
//--------------------------------------------------------------------------------
//@public members
//--------------------------------------------------------------------------------

  /**
    @brief Prefix of commands handled by this handler.

    Must be unique across all registered handlers (both CTRL and TypeScript).
    The framework uses this prefix to route incoming WebSocket commands to the
    correct handler. For example, with prefix "customization.example.", a client
    command "customization.example.disk.free" will be routed here and
    handleRequest() will receive "disk.free" as the command argument.

    Note: This handler has the same prefix as CustomerTsRequestHandler.ts.
    In practice you would use separate prefixes for CTRL and TypeScript
    handlers, or put all commands in one handler. This example uses the same
    prefix for demonstration purposes -- make sure only one of them is
    registered at a time.
   */
  public const string COMMAND_PREFIX = "customization.example.";

//--------------------------------------------------------------------------------
//@protected members
//--------------------------------------------------------------------------------

  /**
    @brief Handles incoming WebSocket commands (with prefix already stripped).

    Implement a switch statement to dispatch to the appropriate handler method
    for each supported command. For unrecognized commands, delegate to the
    parent implementation which will return an "InvalidCommand" error.

    @param command Name of the command (prefix already stripped).
                   For example, if the client sends "customization.example.disk.free",
                   this parameter will be "disk.free".
    @param params  Mapping containing the command parameters sent by the client.
    @param result  Mapping for the command result. Put result data into
                   result["data"] on success, or use setError() on failure.
                   If result contains a "data" key, the client treats the
                   response as successful.
    @param context Connection-specific context providing user information and
                   per-connection state.
   */
  protected void handleRequest(const string &command, const mapping &params, mapping &result,
                                shared_ptr<WssClientConnectionContext> context)
  {
    // Dispatch to the correct handler method based on the command name
    switch ( command )
    {
      case "disk.free"  : diskFreeRequest(params, result);            break;

      // Unknown command: delegate to the parent class, which will generate
      // an "InvalidCommand" error response for the client.
      default: WssRequestHandlerBase::handleRequest(command, params, result, context);
    }
  }

//--------------------------------------------------------------------------------
//@private members
//--------------------------------------------------------------------------------

  /**
    @brief Conversion factors from kilobytes to other units.

    Used by diskFreeRequest() to convert the raw kB value from the
    _ArchivDisk data point to the unit requested by the client.
   */
  private const mapping DISK_SIZE_FACTORS = makeMapping("KB", 1.0,
                                                         "MB", 1024.0,
                                                         "GB", 1024.0 * 1024.0,
                                                         "TB", 1024.0 * 1024.0 * 1024.0);

  /**
    @brief Handles the "customization.example.disk.free" command.

    Reads the free disk space from the _ArchivDisk internal data point and
    returns it in the requested unit (kB, MB, GB, or TB). This demonstrates:

      - Reading WinCC OA data points with dpGet()
      - Using checkLastError() to detect and report dpGet() failures
        (checkLastError() checks getLastError() and, if an error occurred,
        populates the result mapping with error information and returns false)
      - Using setError() to report application-level errors
      - Returning data via result[WssConstants::DATA_KEY]

    Example client request:
      { "command": "customization.example.disk.free", "params": { "unit": "GB" } }

    Example response data:
      42.5  (free space in GB)

    @param params Mapping containing command parameters.
                  - unit (optional): one of "KB", "MB", "GB", "TB". Default is "GB".
    @param result Mapping for the command result. On success, result["data"]
                  contains the free space value. On error, result contains
                  error information populated by checkLastError() or setError().
   */
  private void diskFreeRequest(const mapping &params, mapping &result)
  {
    // Read the free disk space in kB from the _ArchivDisk internal data point.
    // _ArchivDisk is maintained automatically by WinCC OA.
    long freeKB;
    dpGet("_ArchivDisk.FreeKB", freeKB);

    // checkLastError() is a helper from WssRequestHandlerBase that checks
    // whether the previous dpGet() caused an error (via getLastError()).
    // If an error occurred, it populates the result mapping with the error
    // details and returns false, so the handler can return immediately.
    if ( !checkLastError(result) )
      return; // coco validated: defensive (cannot be covered by automatic tests)

    // Get the requested unit from the params, defaulting to "GB"
    string unit = params.value("unit", "GB");

    // Look up the conversion factor for the requested unit.
    // If the unit is not recognized, return an error to the client.
    // setError() populates the result mapping with the error message,
    // which the framework sends back to the client as an error response.
    double factor = DISK_SIZE_FACTORS.value(unit.toUpper(), 0);
    if ( factor == 0 )
    {
      setError(result, "Unknown unit requested: '" + params["unit"] + "'");
      return;
    }

    // Store the result in the "data" key of the result mapping.
    // When the result mapping contains a "data" key (WssConstants::DATA_KEY),
    // the framework treats the response as successful and sends the value
    // back to the client.
    //
    // Keep the value as a long (integer) if kB is requested to avoid
    // unnecessary floating-point conversion.
    result[WssConstants::DATA_KEY] = ( unit.toUpper() == "KB") ? freeKB : freeKB / factor;
  }
};

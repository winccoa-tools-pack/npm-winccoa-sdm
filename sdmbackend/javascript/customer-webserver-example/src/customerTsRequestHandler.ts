// -----------------------------------------------------------------------------
// CustomerTsRequestHandler
// -----------------------------------------------------------------------------
// This file demonstrates how to implement a custom WebSocket request handler
// in TypeScript.
//
// Request handlers process commands sent by WebUI clients over WebSocket.
// Each handler is responsible for a set of commands that share a common
// dot-separated prefix (e.g. "customization.example."). When a client sends a
// command like "customization.example.type.name", the framework:
//
//   1. Strips the prefix, leaving "type.name"
//   2. Passes "type.name" to this handler's handleRequest() method
//   3. The handler processes the command and writes the result into the
//      WsjRequestResult object
//   4. The framework sends the result back to the client, correlated by UUID
//
// To create your own handler:
//   1. Extend WsjRequestHandlerBase
//   2. Return your prefix from the `prefix` getter
//   3. Override handleRequest() with a switch on the command name
//   4. Register the handler in CustomerDashboardServer.registerStandardHandlers()
// -----------------------------------------------------------------------------

import {
  WsjConnectionContext,
  WsjRequestHandlerBase,
  WsjRequestResult
} from '@winccoa/backend';

/**
 * Example for a customer-specific WebSocket request handler.
 *
 * This handler responds to commands prefixed with "customization.example."
 * and demonstrates:
 *   - Defining a command prefix
 *   - Validating request parameters
 *   - Accessing the WinCC OA API via the connection context
 *   - Returning results to the client
 */
export class CustomerTsRequestHandler extends WsjRequestHandlerBase {
  /**
   * The dot-separated prefix for commands handled by this class.
   *
   * The framework uses this prefix to route incoming WebSocket commands to
   * the correct handler. For example, with prefix "customization.example.", a
   * client command "customization.example.type.name" will be routed here and
   * handleRequest() will receive "type.name" as the command argument.
   *
   * Each handler's prefix must be unique across all registered handlers.
   */
  get prefix(): string {
    return 'customization.example.';
  }

  /**
   * Handles a single client request.
   *
   * This method is called by the framework after stripping the prefix from
   * the original command. Implement a switch statement to dispatch to the
   * appropriate handler method for each supported command.
   *
   * For unrecognized commands, delegate to super.handleRequest() -- the base
   * class will return an appropriate error to the client.
   *
   * @param command  Command name with the prefix already stripped.
   *                 For example, if the client sends "customization.example.type.name",
   *                 this parameter will be "type.name".
   * @param params   The parameters object sent by the client. Its structure
   *                 depends on the command. Use assertRequiredParameters()
   *                 and assertNotEmpty() to validate before processing.
   * @param result   A pre-initialized result object carrying the request's UUID.
   *                 Call result.setSuccess(data) to return data to the client.
   * @param context  The connection context for this WebSocket session. Provides
   *                 access to the WinCC OA API via context.winccoa (e.g.
   *                 dpGet, dpSet, dpTypeName, etc.).
   * @returns A promise resolving to the result object.
   */
  async handleRequest(
    command: string,
    params: object,
    result: WsjRequestResult,
    context: WsjConnectionContext
  ): Promise<WsjRequestResult> {
    switch (command) {
      case 'type.name':
        this.typeNameRequest(params as TypeNameParams, result, context);
        break;
      case 'connect':
        this.connectRequest(params as ConnectParams, result, context);
        break;
      case 'disconnect':
        this.disconnectRequest(params as DisconnectParams, result, context);
        break;
      default:
        // Delegate to base class for unknown commands -- this will return
        // an "InvalidCommand" error to the client.
        return await super.handleRequest(command, params, result, context);
    }

    return result;
  }

  /**
   * Handles the "customization.example.type.name" command.
   *
   * Given one or more data point names, returns a mapping of each DP name
   * to its data point type name. This demonstrates:
   *
   *   - Parameter validation with assertRequiredParameters() / assertNotEmpty()
   *     (both throw a WsjError with HTTP 400 if validation fails, which is
   *     automatically sent back to the client as an error response)
   *   - Accessing the WinCC OA API through the connection context
   *   - Returning structured data via result.setSuccess()
   *
   * Example client request:
   * ```json
   * {
   *   "command": "customization.example.type.name",
   *   "params": { "dpNames": ["ExampleDP_Arg1", "ExampleDP_Arg2"] }
   * }
   * ```
   *
   * Example response data:
   * ```json
   * { "ExampleDP_Arg1": "ExampleDP_Float", "ExampleDP_Arg2": "ExampleDP_Int" }
   * ```
   *
   * @param params  Must contain a "dpNames" property (string or string[]).
   * @param result  Result object -- call setSuccess() to populate and return.
   * @param context Connection context providing access to WinCC OA via
   *                context.winccoa.
   */
  private typeNameRequest(
    params: TypeNameParams,
    result: WsjRequestResult,
    context: WsjConnectionContext
  ) {
    // Validate that the required "dpNames" parameter is present and non-empty.
    // These helper methods (inherited from WsjRequestHandlerBase) throw a
    // WsjError with code MissingParameter (HTTP 400) if validation fails.
    // The framework catches the error and sends it back to the client
    // automatically -- no try/catch needed here.
    this.assertRequiredParameters(params, 'dpNames');
    this.assertNotEmpty(params, 'dpNames');

    // Normalize to array so the rest of the code can handle both cases
    let names = params.dpNames;
    if (!Array.isArray(names)) names = [names];

    // Use the WinCC OA API on the connection context to look up the DP type
    // name for each requested data point. context.winccoa is a per-connection
    // WinccoaManager instance that provides the full WinCC OA scripting API.
    const typeMap: { [key: string]: string } = {};
    for (const dpName of names) {
      typeMap[dpName] = context.winccoa.dpTypeName(dpName);
    }

    // Send the result back to the client. setSuccess() marks the result as
    // successful and attaches the data payload. The framework then serializes
    // the result and sends it over the WebSocket, correlated by UUID.
    result.setSuccess(typeMap);
  }

  // ---------------------------------------------------------------------------
  // connect -- subscribe to live data point value updates
  // ---------------------------------------------------------------------------

  /**
   * Handles the "customization.example.connect" command.
   *
   * Establishes a dpConnect subscription so the client receives live value
   * updates whenever the specified data points change. This is the TypeScript
   * equivalent of the CTRL connectWrapper() / dpConnect pattern.
   *
   * How it works:
   *   1. The client sends a "connect" command with a list of DP names.
   *   2. This handler calls context.dpConnect(), which:
   *      a. Registers a WinCC OA dpConnect callback internally
   *      b. Maps the request's UUID to the connection ID
   *      c. On every value change, automatically sends an update to the client
   *         via the WebSocket, correlated by the original request UUID
   *   3. The initial response uses setSuccess(true, false, false):
   *      - data = true: confirms the subscription was established
   *      - suppressSuccessCallback = false: client receives the success callback
   *      - lastInRequest = false: tells the client to keep listening for more
   *        responses on this UUID (the live value updates)
   *
   * The "answer" parameter controls whether an initial value is sent
   * immediately when the connection is established (defaults to true).
   *
   * Example client request:
   * ```json
   * {
   *   "command": "customization.example.connect",
   *   "params": { "dpNames": ["ExampleDP_Arg1.", "ExampleDP_Arg2."] },
   *   "uuid": 42
   * }
   * ```
   *
   * Initial response (confirming subscription):
   * ```json
   * { "uuid": 42, "data": true, "last": false }
   * ```
   *
   * Subsequent callback responses (on each value change):
   * ```json
   * { "uuid": 42, "data": { "dp": ["ExampleDP_Arg1."], "value": [3.14] }, "last": false }
   * ```
   *
   * To stop receiving updates, send a "customization.example.disconnect" command
   * with the same UUID.
   *
   * @param params  Must contain "dpNames" (string or string[]). May optionally
   *                contain "answer" (boolean, defaults to true).
   * @param result  Result object -- setSuccess() is called with lastInRequest=false.
   * @param context Connection context providing dpConnect()/dpDisconnect().
   */
  private connectRequest(
    params: ConnectParams,
    result: WsjRequestResult,
    context: WsjConnectionContext
  ) {
    // Validate that "dpNames" is present and non-empty.
    this.assertRequiredParameters(params, 'dpNames');
    this.assertNotEmpty(params, 'dpNames');

    // Normalize to array so dpConnect receives a consistent type.
    let names = params.dpNames;
    if (!Array.isArray(names)) names = [names];

    // The "answer" flag controls whether the initial current value is sent
    // to the client immediately upon connecting. Default is true (send it).
    const answer = params.answer !== undefined ? params.answer : true;

    // Register the dpConnect subscription. The context maps result.uuid to
    // the internal connection ID and sets up a callback that automatically
    // sends value updates to the client over the WebSocket.
    context.dpConnect(result.uuid, names, answer);

    // Confirm to the client that the subscription was established.
    // - data: true (subscription confirmed)
    // - suppressSuccessCallback: false (client gets the success callback)
    // - lastInRequest: false (more responses will follow via dpConnect callbacks)
    result.setSuccess(true, false, false);
  }

  // ---------------------------------------------------------------------------
  // disconnect -- unsubscribe from live data point value updates
  // ---------------------------------------------------------------------------

  /**
   * Handles the "customization.example.disconnect" command.
   *
   * Removes a dpConnect subscription that was previously established by the
   * "connect" command. After this call, the client will no longer receive
   * value updates for the specified connection.
   *
   * The client must provide the UUID of the original "connect" request so the
   * framework can look up and remove the correct subscription.
   *
   * Example client request:
   * ```json
   * {
   *   "command": "customization.example.disconnect",
   *   "params": { "connectUuid": 42 }
   * }
   * ```
   *
   * Response:
   * ```json
   * { "data": true }
   * ```
   *
   * If the provided connectUuid does not match any active subscription,
   * the framework throws a WsjError with code InvalidUUID (HTTP 400),
   * which is automatically returned to the client as an error response.
   *
   * @param params  Must contain "connectUuid" (number or string) -- the UUID
   *                of the original connect request.
   * @param result  Result object -- setSuccess() is called with default
   *                lastInRequest=true (this is a one-shot response).
   * @param context Connection context providing dpConnect()/dpDisconnect().
   */
  private disconnectRequest(
    params: DisconnectParams,
    result: WsjRequestResult,
    context: WsjConnectionContext
  ) {
    // Validate that the required "connectUuid" parameter is present.
    this.assertRequiredParameters(params, 'connectUuid');

    // Remove the dpConnect subscription. The context looks up the connection
    // ID that was stored when dpConnect() was called with this UUID, then
    // calls winccoa.dpDisconnect() to stop receiving value change callbacks.
    // Throws WsjError(InvalidUUID) if the UUID is not found.
    context.dpDisconnect(params.connectUuid);

    // Confirm to the client that the disconnection was successful.
    // Uses default parameters: data=true, lastInRequest=true (no more
    // responses will follow for this request).
    result.setSuccess(true);
  }
}

// =============================================================================
// Parameter type definitions
// =============================================================================

/**
 * Type definition for the params object of the "type.name" command.
 *
 * The client may send either a single DP name or an array of DP names.
 */
type TypeNameParams = {
  dpNames: string | string[];
};

/**
 * Type definition for the params object of the "connect" command.
 *
 * @property dpNames  One or more data point names to subscribe to.
 * @property answer   Optional. If true (default), the current value is sent
 *                    immediately when the subscription is established.
 */
type ConnectParams = {
  dpNames: string | string[];
  answer?: boolean;
};

/**
 * Type definition for the params object of the "disconnect" command.
 *
 * @property connectUuid  The UUID of the original "connect" request. This is
 *                        used to identify which subscription to remove.
 *                        Can be a number or string, matching the RequestUUID type.
 */
type DisconnectParams = {
  connectUuid: number | string;
};

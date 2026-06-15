// $License: NOLICENSE
//--------------------------------------------------------------------------------
/**
  @file $relPath
  @copyright $copyright
  @author z003yh5a
*/

//--------------------------------------------------------------------------------
// CustomerCtrlHttpEndpoints
//--------------------------------------------------------------------------------
// This file demonstrates how to implement HTTP endpoints in CTRL.
//
// Unlike CTRL request handlers (which process WebSocket commands), CTRL HTTP
// endpoints handle standard HTTP GET requests. They are the CTRL equivalent
// of Express route handlers in TypeScript.
//
// How CTRL HTTP endpoints work:
//   1. A route is defined in TypeScript using WsjCtrlEndpointRoute.routes()
//      (see customerRoutes.ts), specifying a service name and function name.
//   2. When an HTTP request arrives at that route, the framework calls
//      WsjEmbeddedCtrlUser.callUserHttpEndpoint() in the embedded CTRL runtime.
//   3. callUserHttpEndpoint() dispatches to the correct CTRL class and method
//      based on the service name and function name.
//   4. The CTRL function returns a dyn_string containing the response body
//      and HTTP status header.
//
// This approach allows you to implement HTTP endpoints in CTRL when you need
// direct access to CTRL-only APIs or want to keep the logic close to the
// WinCC OA runtime.
//
// Return value format:
//   The CTRL function must return a dyn_string with at least two elements:
//     [1] = response body (HTML, JSON, plain text, etc.)
//     [2] = HTTP status line, e.g. "Status: 200 OK" or "Status: 400 Bad Request"
//   Additional elements can contain extra HTTP headers.
//--------------------------------------------------------------------------------


/**
  @brief Class implementing HTTP endpoints in CTRL.

  Each public static method in this class can serve as an HTTP endpoint.
  The method is called by WsjEmbeddedCtrlUser.callUserHttpEndpoint() when
  a matching HTTP request arrives.

  The method signature must be:
    public static dyn_string methodName(
      const dyn_string &names,   // query parameter names
      const dyn_string &values   // query parameter values (parallel array)
    )

  The names and values arrays are parallel: names[i] is the parameter name
  and values[i] is its value. For example, for the URL
    /customer/diskfree?unit=MB
  names would be ["unit"] and values would be ["MB"].
 */
class CustomerCtrlHttpEndpoints
{
  /**
    @brief Creates an HTML page showing the free capacity of the archive disk.

    This endpoint reads the _ArchivDisk.FreeKB data point and displays the
    free disk space in one or all supported units (kB, MB, GB, TB).

    Route (defined in customerRoutes.ts):
      GET /customer/diskfree

    Query parameters:
      - unit (optional): one of "kb", "mb", "gb", "tb", or "all" (default).
        Controls which unit(s) are displayed on the page.

    Examples:
      /customer/diskfree              -> shows all units
      /customer/diskfree?unit=gb      -> shows only GB
      /customer/diskfree?unit=mb      -> shows only MB

    @param names  Query parameter names (parallel array with values).
    @param values Query parameter values (parallel array with names).
    @return dyn_string with two elements:
            [1] = HTML content (the response body)
            [2] = HTTP status line (e.g. "Status: 200 OK")
   */
  public static dyn_string diskFree(const dyn_string &names, const dyn_string &values)
  {
    // Read the free disk space in kB from the _ArchivDisk internal data point.
    // This data point is maintained automatically by WinCC OA.
    const string dpName = "_ArchivDisk.FreeKB";
    float freeKB;
    int sts = dpGet(dpName, freeKB);

    // If dpGet() failed (non-zero return), return an HTTP 500 error.
    // getLastError() retrieves the error details from the last WinCC OA API
    // call, which are included in the response body for debugging.
    if ( sts != 0 )
    {
      dyn_errClass errors = getLastError();
      return makeDynString(errors, "Status: 500 Internal Server Error");
    }

    // Extract the "unit" query parameter from the parallel name/value arrays.
    // Default to "all" (show all units) if not specified.
    string unit = "all";
    int unitIdx = names.indexOf("unit");
    if (unitIdx >= 0)
      unit = strtolower(values.at(unitIdx));

    // Validate the requested unit against the allowed list.
    // Return HTTP 400 Bad Request for invalid units.
    if (!ALLOWED_UNITS.contains(unit))
      return makeDynString("Invalid unit: " + unit, "Status: 400 Bad Request");

    // Build a simple HTML page displaying the free disk space.
    // The page shows one or more lines depending on the requested unit.
    string content =
    "<http>\n"
    "  <head><title>Archive Disk Free Size</title></head>\n"
    "  <body>\n"
    "    <h1>Archive Disk Free Size</h1>\n"
    "    <h3>" + dpName + "</h3>\n"
    "      <pre>\n";

    // Add a formatted line for each requested unit.
    // When unit is "all", all four lines are included.
    if ((unit == "kb") || (unit == "all"))
      content += (formatValue(freeKB) + " kB\n");
    if ((unit == "mb") || (unit == "all"))
      content += (formatValue(freeKB / 1024) + " MB\n");
    if ((unit == "gb" ) || (unit == "all"))
      content += (formatValue(freeKB / (1024 * 1024)) + " GB\n");
    if ((unit == "tb" ) || (unit == "all"))
      content += (formatValue(freeKB / (1024 * 1024 * 1024)) + " TB\n");

    content +=
    "   </pre>\n"
    "  </body>\n"
    "</http>";

    // Return the HTML body and a 200 OK status.
    // The MIME type (text/html) is configured in the route definition
    // in customerRoutes.ts.
    return makeDynString(content, "Status: 200 OK");
  }

  /**
    @brief List of allowed unit values for the diskFree() endpoint.
   */
  private static const dyn_string ALLOWED_UNITS = makeDynString("all", "kb", "mb", "gb", "tb");

  /**
    @brief Formats a numeric value as a right-aligned string for display.

    Uses strformat() to right-align the value in a 15-character field with
    2 decimal places, producing clean columnar output in the HTML page.

    @param value The numeric value to format.
    @return Formatted string (e.g. "         42.50").
   */
  private static string formatValue(float value)
  {
    return strformat("\\right{%12.2}", 15, value);
  }
};

// -----------------------------------------------------------------------------
// ConnectionsController
// -----------------------------------------------------------------------------
// This file demonstrates a more complex HTTP endpoint controller that:
//
//   - Reads live data from WinCC OA (the _Connections data point)
//   - Returns the data in multiple formats (JSON, Markdown, HTML) depending
//     on a query parameter
//   - Uses third-party libraries (showdown, ts-markdown-builder) for output
//     formatting
//
// This is a realistic example of how to build a custom monitoring or
// diagnostic endpoint for a WinCC OA project.
//
// The controller is wired to the URL path /customer/connections via
// ConnectionsRoute and CustomerRoutes. Try these URLs in a browser:
//
//   http://<host>:<port>/customer/connections               (JSON)
//   http://<host>:<port>/customer/connections?format=json    (JSON)
//   http://<host>:<port>/customer/connections?format=html    (HTML)
//   http://<host>:<port>/customer/connections?format=markdown (Markdown)
// -----------------------------------------------------------------------------

import { Converter } from 'showdown';
import * as md from 'ts-markdown-builder';

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';

/**
 * Data structure containing details for a single running WinCC OA manager.
 */
class ManagerDetails {
  constructor(
    /** The manager number (unique per manager type). */
    public managerNumber: number,
    /** The host name the manager is running on. */
    public hostName: string,
    /** The time the manager was started. */
    public startTime: Date
  ) {}
}

/**
 * Data structure grouping all connected managers of a single manager type
 * (e.g. all connected UI managers, all connected CTRL managers, etc.).
 */
class ManagerTypeConnections {
  constructor(
    /** The manager type name (e.g. "WCCOAui", "WCCOActrl"). */
    public managerType: string,
    /** List of individual manager instances of this type. */
    public managers: ManagerDetails[]
  ) {}
}

/**
 * Controller that returns information about currently connected WinCC OA
 * managers.
 *
 * The data is read from the `_Connections` internal data point, which WinCC OA
 * maintains automatically. It contains one sub-element per manager type, each
 * holding arrays of manager numbers, host names, and start times.
 *
 * The output format is controlled by the `format` query parameter:
 *   - `json`     (default) -- returns the data as a JSON array
 *   - `markdown` -- returns a Markdown document with tables
 *   - `html`     -- returns an HTML document (converted from Markdown)
 */
export class ConnectionsController {
  /**
   * Constructor.
   *
   * Initializes the Showdown converter used to transform Markdown into HTML.
   * The `tables` option enables Markdown table syntax support.
   */
  constructor() {
    this.mdConverter = new Converter({ tables: true });
  }

  /**
   * Express request handler that reads connection data from WinCC OA and
   * sends the response in the requested format.
   *
   * This is an arrow function (not a regular method) so that it can be
   * passed directly to `router.use()` without losing the `this` context.
   *
   * @param req UltimateExpress request object.
   * @param res UltimateExpress response object.
   */
  public connectionsData = async (req: Request, res: Response) => {
    // Read the current connection details from the _Connections data point.
    // This returns a nested structure: one entry per manager type, each
    // containing an array of individual manager details.
    const connections = await this.connectionDetails('_Connections');

    // Determine the requested output format from the query string.
    // Default to JSON if no format is specified.
    const format = (req.query['format'] as string) ?? 'json';
    switch (format) {
      case 'json':
        // JSON: Express serializes the data structures automatically
        res.status(200).json(connections);
        break;
      case 'markdown':
        // Markdown: convert the data to Markdown tables and return as
        // plain text with the appropriate content type
        res
          .status(200)
          .contentType('text/markdown')
          .send(this.toMarkdown(connections));
        break;
      case 'html':
        // HTML: convert data to Markdown first, then to HTML using Showdown
        res.status(200).send(this.toHtml(connections));
        break;
      default:
        // Unknown format: return a 400 Bad Request error
        res
          .status(400)
          .send(`Invalid value for query parameter 'format': '${format}'`);
        break;
    }
  };

  /**
   * Reads manager connection information from a `_Connections` data point.
   *
   * The `_Connections` data point type in WinCC OA has one child element per
   * manager type (e.g. "WCCOAui", "WCCOActrl"). Each child element contains
   * three array DPEs:
   *   - `ManNums`    -- manager numbers (int[])
   *   - `HostNames`  -- host names (string[])
   *   - `StartTimes` -- start timestamps (time[])
   *
   * This method reads all three arrays for each manager type using dpGet()
   * and assembles them into a structured result.
   *
   * @param dpName Name of the _Connections data point (usually "_Connections").
   * @returns Array of {@link ManagerTypeConnections}, one per manager type.
   */
  private async connectionDetails(
    dpName: string
  ): Promise<ManagerTypeConnections[]> {
    // Get the data point type definition for _Connections.
    // dpTypeGet() returns the type structure including all child elements,
    // which tells us the names of all manager types.
    //
    // WsjServerGlobal.winccoa is the shared (server-wide) WinCC OA API
    // instance. It is used here because this is an HTTP endpoint, not a
    // WebSocket request handler -- there is no per-connection context.
    const typeDef = WsjServerGlobal.winccoa.dpTypeGet('_Connections');

    const result: ManagerTypeConnections[] = [];
    for (const child of typeDef.children) {
      // For each manager type (child element), read the three arrays
      // in a single dpGet() call for efficiency.
      const baseName = `${dpName}.${child.name}`;
      const values = (await WsjServerGlobal.winccoa.dpGet([
        `${baseName}.ManNums`,
        `${baseName}.HostNames`,
        `${baseName}.StartTimes`
      ])) as unknown[][];

      // Combine the three parallel arrays into an array of ManagerDetails
      // objects (one per connected manager instance).
      const details: ManagerDetails[] = [];
      for (let i = 0; i < values[0].length; i++)
        details.push(
          new ManagerDetails(
            values[0][i] as number,
            values[1][i] as string,
            values[2][i] as Date
          )
        );

      result.push(new ManagerTypeConnections(child.name, details));
    }

    return result;
  }

  /**
   * Converts manager connection data to an HTML document.
   *
   * Uses a two-step conversion: first to Markdown (via {@link toMarkdown}),
   * then from Markdown to HTML using the Showdown library.
   *
   * @param connections List of manager type connections.
   * @returns HTML string.
   */
  private toHtml(connections: ManagerTypeConnections[]): string {
    const markdown = this.toMarkdown(connections);
    return this.mdConverter.makeHtml(markdown);
  }

  /**
   * Converts manager connection data to a Markdown document.
   *
   * Uses the ts-markdown-builder library to generate clean Markdown with
   * headings and tables. Each manager type gets its own section with a
   * table listing the connected manager instances.
   *
   * @param connections List of manager type connections.
   * @returns Markdown string.
   */
  private toMarkdown(connections: ManagerTypeConnections[]): string {
    // Start with a top-level heading
    const managerTypes: string[] = [md.heading('Manager Connections')];

    for (const connection of connections) {
      // Build table rows: one row per connected manager instance
      const rows: string[][] = [];
      for (const manager of connection.managers) {
        rows.push([
          manager.managerNumber.toString(),
          manager.hostName,
          manager.startTime.toUTCString()
        ]);
      }

      // Add a sub-section for this manager type with either a table of
      // connected managers or a "no connections" message
      managerTypes.push(
        md.joinBlocks([
          md.heading(connection.managerType, { level: 3 }),
          rows.length > 0
            ? md.table(['-num', 'Host name', 'Start time'], rows)
            : 'no connections'
        ])
      );
    }

    // Combine all sections into a single Markdown document
    return md.joinBlocks(managerTypes);
  }

  /** Showdown converter instance used to convert Markdown to HTML. */
  private readonly mdConverter: Converter;
}

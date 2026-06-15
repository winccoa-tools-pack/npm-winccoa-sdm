# webserver.js customization example

This example shows how to customize a [_SIMATIC WinCC Open Architecture_](https://www.winccoa.com/)
**webserver.js** with working examples for custom request handlers, HTTP endpoints, and routes
-- in both TypeScript and CTRL.

## Generated project structure

```
<project-directory>/
  README.md
  javascript/
    customer-webserver-example/
      src/
        index.ts                     # Entry point exports
        customerDashboardServer.ts   # Custom WsjDashboardServer subclass
        customerTsRequestHandler.ts  # Example TypeScript request handler
        customerRoutes.ts            # Example Express-style routes
        connectionsRoute.ts          # Example route definition
        connectionsController.ts     # Example controller (JSON/Markdown/HTML)
      run.js                         # JavaScript Manager entry point
      package.json
      tsconfig.json
      eslint.config.mjs
      .prettierrc
      .gitignore
  scripts/
    libs/classes/wsjServer/
      WsjEmbeddedCtrlUser.ctl        # CTRL extension point (registers handlers)
      CustomerCtrlRequestHandler.ctl # Example CTRL request handler
      CustomerCtrlHttpEndpoints.ctl  # Example CTRL HTTP endpoint
```

## Initial setup

1. **Add the project to your WinCC OA project**

   Add the project directory to the list of sub-projects in `config/config`.

2. **Install dependencies**

   ```bash
   cd <project-directory>/javascript/customer-webserver-example
   npm install
   npm install --save-dev <path-to-installation>/javascript/@types/winccoa-manager
   ```

3. **Build**

   ```bash
   npm run build
   ```

   Or start a watcher for automatic re-compilation:

   ```bash
   npm run watch
   ```

4. **Add a JavaScript Manager**

   Create a JavaScript Manager in your WinCC OA project with
   `customer-webserver-example/run.js` as its
   parameter.

5. **Lint and format** (optional)

   ```bash
   npm run lint
   npm run format
   ```

6. **Modify**

   After you're familiar with the example project, you likely will rename it and replace
   the example code with the final webserver.js modifications

## Included examples

The template contains working examples for the most common customization
scenarios:

### TypeScript

| File                          | What it demonstrates                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `customerDashboardServer.ts`  | Subclassing `WsjDashboardServer` to register custom handlers and routes                                                          |
| `customerTsRequestHandler.ts` | Implementing a request handler with one-shot (`type.name`) and live-subscription (`connect`/`disconnect` via dpConnect) commands |
| `customerRoutes.ts`           | Adding Express-style HTTP routes (static files, dynamic endpoints, CTRL endpoints)                                               |
| `connectionsController.ts`    | A controller that queries WinCC OA data and returns JSON, Markdown, or HTML                                                      |

### CTRL

| File                             | What it demonstrates                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| `CustomerCtrlRequestHandler.ctl` | Implementing a request handler in CTRL (`customization.example.disk.free`) |
| `CustomerCtrlHttpEndpoints.ctl`  | Implementing an HTTP endpoint in CTRL (HTML page)                          |
| `WsjEmbeddedCtrlUser.ctl`        | Registering CTRL handlers and routing CTRL endpoint calls                  |

## Dependencies

The generated project depends on
[`@wincc-oa/backend`](../npm-backend), which provides base
classes and utilities for webserver.js backend development:

- `WsjDashboardServer` -- base server class
- `WsjRequestHandlerBase` / `WsjRequestHandlerRegistry` -- request handler infrastructure
- `WsjRoutes`, `WsjStaticLiveDirectoryRoute`, `WsjCtrlEndpointRoute` -- routing utilities
- `WsjAccessControlList` -- access control
- `WsjServerGlobal` -- global server state and WinCC OA API access

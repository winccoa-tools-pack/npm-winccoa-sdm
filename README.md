# WinCC OA — `javascript/` Pakete

Dieses Verzeichnis bündelt die Node.js-/TypeScript-Bausteine rund um das
**Semantic Data Model (SDM)** für WinCC OA 3.21: das Backend (webserver.js-
Customization mit den `sdm.*`-WebSocket-Befehlen), die WebUI-Seite, den
MCP-Server für KI/Automatisierung sowie die daraus erzeugten, veröffentlichbaren
npm-Pakete.

## Überblick

| Verzeichnis | Paketname | Rolle | npm |
|---|---|---|---|
| [`sdm/`](./sdm) | `winccoa-sdm` | **Dev-Quelle** des SDM-Backends (Single Source of Truth) | – (intern) |
| [`sdm-backend/`](./sdm-backend) | `@martinkumhera/winccoa-sdm-backend` | **Publish-Paket** des Backends (aus `sdm/` gespiegelt) | ✅ veröffentlicht |
| [`sdm-page/`](./sdm-page) | `@martinkumhera/winccoa-sdm-page` | **Publish-Paket** der `/sdm`-WebUI-Seite | ✅ veröffentlicht |
| [`mcpWinCCOA/`](./mcpWinCCOA) | `@etm-professional-control/winccoa-mcp-server` | **MCP-Server** für WinCC OA (inkl. SDM-Tools) | ✅ (ETM) |
| [`sdmbackend/`](./sdmbackend) | – | **Beispiel**: webserver.js-Customization (Referenz, kein Paket) | – |

## Wie die Teile zusammenhängen

```
                ┌──────────────────────────────┐
   du editierst │  sdm/src/**   (winccoa-sdm)   │  ← Single Source of Truth
                └──────────────┬───────────────┘
            npm run build (tsc)│  → sdm/dist
                               │
            (sdm-backend) npm run sync:dist
                               ▼
        sdm-backend/{dist,src,run.js,tsconfig.json}
                               │  npm publish
                               ▼
              @martinkumhera/winccoa-sdm-backend   (npm)


   frontend/…/standalone-pages/sdm/**  ← kanonische Frontend-Quelle
                               │  npm run build:pages (OUT_DIR=…/data/dashboard-wc)
                               ▼
        data/dashboard-wc/pages/sdm.js
                               │  (sdm-page) npm run sync:dist
                               ▼
        sdm-page/dist/pages/sdm.js  +  lib/, pages/ (Quell-Spiegel)
                               │  npm publish
                               ▼
              @martinkumhera/winccoa-sdm-page   (npm)
```

**Merksatz:** In `sdm/` (Backend) bzw. `frontend/` (Seite) wird **entwickelt**;
`sdm-backend/` und `sdm-page/` werden daraus **erzeugt und veröffentlicht** — sie
sind Richtung Quelle read-only und sollten nie händisch bearbeitet werden.

## Die Pakete im Einzelnen

### `sdm/` — `winccoa-sdm` (Dev-Quelle Backend)
Das eigentliche SDM-Backend als **webserver.js-Dashboard-Server-Customization**:
exponiert die `sdm.*`-WebSocket-Befehle (Ontologie, Instanzen, typisierte
Relationen/Graph, ISA-95-Hierarchie, CNS-Views, Templates, Bulk-Import,
Validierung, **WinCC-OA-Projektmigration**). Speichert alles in reinen
OA-Primitiven (DPT/DP/CNS) → Redundanz/Verteilung inklusive. Enthält zusätzlich
`docs/` (Migrations- & Quickstart-Guides). Build: `npm run build` (`tsc` → `dist/`).
Manager-Einstieg: `run.js`.

### `sdm-backend/` — `@martinkumhera/winccoa-sdm-backend` (Publish)
Schlanke, veröffentlichbare Fassung von `sdm/` (per `npm run sync:dist`
synchronisiert: `dist/`, `src/`, `run.js`, `tsconfig.json`) plus
Install-Skripte (`scripts/`). Installation/Manager-Registrierung: siehe
[`sdm-backend/README.md`](./sdm-backend/README.md).

### `sdm-page/` — `@martinkumhera/winccoa-sdm-page` (Publish)
WebUI-Page-Paket der `/sdm`-Seite (Route `/sdm`, Menüeintrag *Semantic Model*).
Enthält das gebündelte `dist/pages/sdm.js` (aus dem Frontend-Build gespiegelt),
Quell-Spiegel unter `lib/`/`pages/`, `wui-page.json`-Manifest, `oa-data/`
(Übersetzungen) und Postinstall-Skripte (Projekt- vs. Workspace-Installation).
Details: [`sdm-page/README.md`](./sdm-page/README.md).

### `mcpWinCCOA/` — `@etm-professional-control/winccoa-mcp-server` (MCP)
MCP-Server für WinCC OA mit feldspezifischen Konfigurationen
(`fields/{default,oil,transport}.md`) und den **SDM-MCP-Tools**
(`src/sdm_mcp.js`, Werkzeuge `sdm-*`), über die ein LLM das semantische Modell
lesen und bearbeiten kann. Zwei Bins: `winccoa-mcp-stdio` und `winccoa-mcp-http`.

### `sdmbackend/` — Beispiel (kein Paket)
Referenz-Beispiel „webserver.js customization" (TypeScript + CTRL) für eigene
Request-Handler, HTTP-Endpunkte und Routen. Kein `package.json`, dient nur als
Vorlage.

## Build & Publish (Kurzreferenz)

```bash
# Backend bauen + ins Publish-Paket spiegeln
cd sdm        && npm run build
cd ../sdm-backend && npm run sync:dist

# Seite: im frontend/ bauen (OUT_DIR setzen), dann ins Publish-Paket spiegeln
#   (frontend) $env:OUT_DIR="…/data/dashboard-wc"; npm run build:pages
cd ../sdm-page && npm run sync:dist

# Veröffentlichen (Erstrelease: backend 0.2.1, page 0.2.0)
npm publish ./sdm-backend --access public
npm publish ./sdm-page    --access public
```

> Mehr zum Aufsetzen von WebUI-Runtime + SDM in einem Bestandsprojekt:
> [`sdm/docs/quickstart-existing-project.md`](./sdm/docs/quickstart-existing-project.md).
> Migration eines bestehenden Projekts:
> [`sdm/docs/migration-guide.md`](./sdm/docs/migration-guide.md).

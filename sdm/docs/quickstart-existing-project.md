# Kurzanleitung: SDM in ein bestehendes WinCC OA‑Projekt bringen

Diese Anleitung zeigt am Beispiel **`DemoApplication_3.21`**, wie man

1. die **WebUI‑Runtime** (Dashboard) in einem bestehenden Projekt aufsetzt,
2. das **SDM** (Backend + Seite) installiert und
3. das **Bestandsprojekt** in das Semantische Datenmodell **konvertiert**.

> Basiert auf dem README von [`@wincc-oa/webui-runtime`](https://www.npmjs.com/package/@wincc-oa/webui-runtime)
> sowie den Paketen `@martinkumhera/winccoa-sdm-backend` und
> `@martinkumhera/winccoa-sdm-page`. Migrationsdetails:
> [`migration-guide.md`](./migration-guide.md) (EN: [`migration-guide.en.md`](./migration-guide.en.md)).

Im Beispiel liegt das Projekt unter:

```
D:\WinCC_OA_Proj\DemoApplication_3.21
```

---

## 0. Voraussetzungen

- **WinCC OA 3.21** mit konfiguriertem Projekt (hier `DemoApplication_3.21`).
- **Node.js** (LTS) und npm auf dem Rechner.
- Das Projekt hat einen konfigurierten **`_PanelTopology`** (Navigation/Topologie)
  und **Sammelalarme** (`_SumAlertPanel`) — Standard für Topologie-/Alarmprojekte
  wie das Demo. Nur dann gibt es etwas zu konvertieren.

---

## 1. WebUI‑Runtime im Projekt aufsetzen

Die WebUI‑Runtime ist eine eigene Workspace, die das Dashboard‑Webapp baut und
dessen Build in das Projekt (`data/dashboard-wc`) deployt.

```powershell
# Workspace anlegen (beliebiger Ort, z. B. neben dem Projekt)
mkdir D:\WinCC_OA_Proj\DemoApplication_3.21\webui ; cd D:\WinCC_OA_Proj\DemoApplication_3.21\webui

# Runtime-Sourcen in den Workspace kopieren
npm install @wincc-oa/webui-runtime
npx webui-runtime-init -y

# Dev-Abhängigkeiten + oa-data anlegen
npm install --no-audit --no-fund --include dev
npm run init:oa-data
```

In das Projekt bauen (Ausgabe nach `…\data\dashboard-wc`):

```powershell
$env:OUT_DIR="D:\WinCC_OA_Proj\DemoApplication_3.21\data\dashboard-wc"
npm run build
```

WebServer/WebSocket im Projekt bereitstellen — in der WinCC OA **Console** einen
JavaScript‑Manager hinzufügen (liefert das Dashboard aus):

| Feld | Wert |
|---|---|
| Manager | `WCCOAjavascript` (Node.js JavaScript Manager) |
| Parameter | `webserver-js` |
| Startmodus | `always` |

Der Server lauscht auf dem konfigurierten **`httpsPort`** (Standard **8443** aus
`config/config` `[webserverjs]`; im Demo z. B. `9443`). Aufruf:

```
https://localhost:8443
```

> Entwicklung gegen den laufenden Server (Hot‑Reload auf `http://localhost:4300`):
> `$env:BASE_URL="https://localhost:8443"; npm run start`

---

## 2. SDM installieren

SDM besteht aus zwei Paketen: **Backend** (liefert die `sdm.*`‑WebSocket‑Befehle)
und **Seite** (die `/sdm`‑WebUI‑Seite). Beide werden benötigt.

### 2a. Backend (`@martinkumhera/winccoa-sdm-backend`)

```powershell
cd D:\WinCC_OA_Proj\DemoApplication_3.21\javascript
npm install @martinkumhera/winccoa-sdm-backend
```

Danach in der WinCC OA **Console** einen weiteren JavaScript‑Manager anlegen:

| Feld | Wert |
|---|---|
| Manager | `WCCOAjavascript` |
| Parameter | `node_modules/@martinkumhera/winccoa-sdm-backend/run.js` |
| Startmodus | `manual` (oder `always`) |

- Standardmäßig bedient das Backend den konfigurierten `httpsPort` (8443) und
  **ersetzt** den Standard‑Webserver (es enthält alle Standard‑Dashboard‑Handler).
- Soll es **zusätzlich** neben dem Standard‑Webserver laufen, am Manager setzen:

  ```
  SDM_PORT=8444
  SDM_WSS=/winccoa
  ```

Beim **ersten Start** legt das Backend seine Meta‑Datenpunkttypen selbst an —
kein DPL‑Import nötig.

### 2b. Seite (`@martinkumhera/winccoa-sdm-page`)

Direkt ins Projekt installieren (führt das Postinstall/Manifest aus):

```powershell
cd D:\WinCC_OA_Proj\DemoApplication_3.21\data\WebUI
npm install @martinkumhera/winccoa-sdm-page --omit=peer --omit=dev --foreground-scripts
```

Das trägt den Menüeintrag *Semantic Model* in
`…\data\dashboard-wc\menuconfig.json` ein (das Seiten‑`module` zeigt in
`node_modules`, es wird kein JS kopiert) und seedet die Übersetzungen. Die
nächsten Schritte stehen auch in `dashboard-wc/sdm.NEXT_STEPS.txt`.

Anschließend die WebUI **hart neu laden** (ServiceWorker‑Reset / alle Tabs
schließen). Es erscheint links der Menüpunkt **Semantic Model** → Route `/sdm`.

> Registrierung jederzeit erneut auslösen: `npm run manifest` im Paketordner.

---

## 3. Bestandsprojekt konvertieren

Die Migration leitet die **Asset‑Struktur** aus `_PanelTopology` und die
**Datenpunkt‑Zuordnung** aus den Sammelalarmen ab. Pro **dpType** entsteht eine
SDM‑Klasse, die zugehörigen **Datenpunkte** werden ihre Instanzen (Default
`adopt`). Immer zuerst **Dry‑run**, Plan prüfen, dann **Apply** — idempotent.

### Variante A — über die WebUI (empfohlen)

1. `/sdm` öffnen → Button **„Mass engineering"** (Statusleiste).
2. Reiter **„WinCC OA"**.
3. Checkbox **„Include data‑point assignment (sum‑alarms)"** gesetzt lassen.
4. **Dry‑run** → Plan prüfen (Knoten, Parents, abgeleitete Sammelalarm‑DPs,
   Anzahl referenzierter DPs).
5. **Apply** → Ergebnis (erzeugte Knoten / DPs / Kanten).
6. Reiter **Assets** zeigt den importierten Baum (ggf. „Reload").

### Variante B — über die WebSocket‑API

```text
sdm.oa.importPlan    { includeDataPoints: true, adoptDataPoints: true }   # Dry-run
sdm.oa.importApply   { includeDataPoints: true, adoptDataPoints: true }   # Apply
```

Details, Optionen (`proxy`‑Modus, nur Hierarchie) und Troubleshooting:
[`migration-guide.md`](./migration-guide.md).

---

## 4. Verifizieren

- **WebUI**: `/sdm` → *Assets* — der Baum entspricht der Navigations‑/Topologie‑
  struktur; die Datenpunkte hängen unter ihren Bereichen. Klick auf eine Instanz
  zeigt deren Properties (Strukturen baumartig).
- **Graph**: Instanz‑Inspector → *Show graph* — zeigt die Substruktur
  (Richtung/Relationsart‑Filter in der Kopfzeile).
- **Modell‑Linter**: Befehl `sdm.validate` sollte nach dem Import 0 Fehler melden.

---

## Schnell‑Checkliste

| Schritt | Befehl / Aktion |
|---|---|
| Runtime‑Workspace | `npm i @wincc-oa/webui-runtime` → `npx webui-runtime-init -y` |
| In Projekt bauen | `$env:OUT_DIR="…\data\dashboard-wc"; npm run build` |
| Webserver | Console: `WCCOAjavascript` + `webserver-js` (→ `https://localhost:8443`) |
| SDM‑Backend | `…\javascript> npm i @martinkumhera/winccoa-sdm-backend` + Manager `…/run.js` |
| SDM‑Seite | `…\data\WebUI> npm i @martinkumhera/winccoa-sdm-page` → WebUI hart neu laden |
| Konvertieren | `/sdm` → Mass engineering → WinCC OA → Dry‑run → Apply |

# WinCC OA → SDM: Projekt­migration

Anleitung, wie man ein bestehendes WinCC OA Projekt in das **Semantic Data Model (SDM)**
überführt. Die Migration leitet die **Asset-Struktur** aus der Panel-Topologie
(`_PanelTopology`) ab und die **Datenpunkt-Zuordnung** aus den zugehörigen
**Summenalarm-Konfigurationen**.

> **Erstaufsetzen?** Wer WebUI-Runtime + SDM in einem Bestandsprojekt erst noch
> installieren muss, findet die End-to-End-Kurzanleitung (am Beispiel
> `DemoApplication_3.21`) unter
> [`quickstart-existing-project.md`](./quickstart-existing-project.md).

> TL;DR: `Dry-run` ausführen → Plan prüfen → `Apply`. Idempotent. Ein dpType wird
> zur SDM-Klasse, seine DPs zu Instanzen. Default `adopt` (echte DPs als Instanzen,
> erweitert diese dpTypes einmalig um `sem`); `adoptDataPoints:false` = nicht-invasiver
> Proxy-Modus.

> **Kanonische Quelle.** Diese Datei (`javascript/sdm/docs/`) ist die maßgebliche
> Fassung. Englisch: [`migration-guide.en.md`](./migration-guide.en.md). Eine
> Spiegelung für die Frontend-Doku liegt unter
> `frontend/docs/knowledge/sdm-migration-guide.md` — bei Änderungen mitziehen.

---

## 1. Was die Migration erzeugt

| Quelle im OA-Projekt | Ziel im SDM |
|---|---|
| `_PanelTopology`-Knoten | je eine Instanz der Klasse `oa:TopologyNode` |
| `parentNumber` | `isa:partOf`-Kante (Knoten → Parent) |
| Member-DPEs des Summenalarm-DPs eines Knotens | **eine SDM-Klasse pro dpType**; die Datenpunkte als Instanzen, per `isa:partOf` unter den Knoten gehängt |

Ergebnis: der **Navigations-/Anlagenbaum** des Projekts steht als lebende
`isa:partOf`-Hierarchie im SDM und erscheint sofort im **Asset-Tree** der WebUI
(`/sdm` → Tab *Assets*), mit den zugeordneten Datenpunkten je Bereich.

Automatisch angelegt (falls noch nicht vorhanden):

- der Relationstyp **`isa:partOf`** (functional 0..1, transitiv, inverse `isa:hasPart`)
- `isa:EquipmentElement` (abstrakt, Basis)
- `oa:TopologyNode` (erbt von `isa:EquipmentElement`) — Properties: `panelNumber`,
  `fileName`, `moduleName`, `panelType`, `nodeDescription`, `locality`,
  `functionality`, `uuid`
- **eine Klasse je verwendetem dpType** (Default `adopt`: die Klasse ist auf den
  **echten** OA-Typ gemappt; Fallback `proxy`: `oa:dp:<typ>` mit Property `dpRef`).
  Im `adopt`-Modus übernimmt die Klasse **alle Datenpunktelemente** des Typs als
  Properties (verschachtelte Structs als Dotted-Paths, z. B. `state.value`).

---

## 2. Voraussetzungen

1. **Der Importer muss im Manager des Zielprojekts laufen.** Das SDM-Backend
   (`javascript/sdm`) bzw. der SDM-MCP-Server liest `_PanelTopology` und die
   Summenalarm-DPs über `dpGet`/`dpNames` des **lokalen** Managers. Um Projekt *X*
   zu migrieren, muss der SDM-Manager in Projekt *X* gestartet sein (nicht in einem
   anderen Projekt dagegen zeigen).
2. **Das Zielprojekt enthält eine konfigurierte `_PanelTopology`** (Navigation/
   Topologie-Editor) — andernfalls gibt es nur den Default-Knoten und nichts zu
   migrieren.
3. **Für die DP-Zuordnung**: die Bereichs-Summenalarme sind als `_SumAlertPanel`-
   DPs konfiguriert (Standard bei Topologie-/Alarmschirm-Projekten).
4. Das SDM-Backend ist gebaut und läuft (siehe Projekt-README; `npm run build`
   im `javascript/sdm`).

---

## 3. Das Mapping im Detail

### 3.1 Asset-Hierarchie aus `_PanelTopology`

`_PanelTopology` ist **eine** DP mit parallelen dynamischen Arrays; Knoten *i*
ergibt sich aus dem Index *i* über alle Arrays:

| Element | Verwendung |
|---|---|
| `panelNumber[i]` | Knoten-ID → Instanzname `oaNode_<panelNumber>` |
| `parentNumber[i]` | Parent-ID; **`0` = Root** → `isa:partOf` |
| `nodeName[i]` | Anzeigename (Label) |
| `fileName[i]` | Panel-Datei → für die Summenalarm-DP-Ableitung |
| `description` / `locality` / `functionality` | Properties am Knoten |
| `moduleName` / `panelType` / `uuid` | Properties am Knoten |
| `sumAlertNumber[i]` | Teil der Summenalarm-DP-Ableitung |

Knoten ohne echte Panel-Datei (`fileName` leer oder `EXECSCRIPT …`) werden als
Knoten angelegt, bekommen aber keine DP-Zuordnung.

### 3.2 Datenpunkt-Zuordnung aus den Summenalarmen

Jeder Topologie-Knoten besitzt einen **eigenen** Summenalarm-DP. Dessen Name wird
aus `fileName` und `sumAlertNumber` abgeleitet:

```
sumAlertPanelDp = stripExt(fileName).replace(/[/\\]/g, "_") + "_" + sumAlertNumber
```

- `stripExt` entfernt die Datei­endung (z. B. `.pnl`)
- `/` und `\` werden zu `_`
- am Ende `_<sumAlertNumber>`

**Beispiele (aus dem WinCC OA Demo-Projekt):**

| Knoten | `fileName` | `sumAlertNumber` | abgeleiteter DP |
|---|---|---|---|
| Wasserversorgung | `mainpanels/water_supply.pnl` | 1 | `mainpanels_water_supply_1` |
| Produktion | `mainpanels/production.pnl` | 1 | `mainpanels_production_1` |
| Reaktionsbehälter | `mainpanels/reactor.pnl` | 1 | `mainpanels_reactor_1` |

> Hinweis: Auch wenn mehrere Knoten dieselbe `sumAlertNumber` haben (im Demo z. B.
> alle Anlagenbereiche `=1`), unterscheiden sich die DPs durch den `fileName` — pro
> Bereich also ein eigener Summenalarm-DP.

Der Summenalarm-DP ist vom Typ `_SumAlertPanel` mit den Elementen
`Warning` / `Alert` / `Danger`. Die Member-Datenpunkte werden aus der
Alert-Konfiguration aller drei Ebenen gelesen und vereinigt:

```
member-DPEs = ⋃ über {Warning, Alert, Danger}:
                <dp>.<level>:_alert_hdl.._dp_list          (explizite DPE-Liste)
              ∪ dpNames(<dp>.<level>:_alert_hdl.._dp_pattern)  (Wildcard-Pattern)
```

Aus jeder Member-DPE wird der reine DP-Name extrahiert und dedupliziert.

**Wesentlich: ein dpType ist eine Klasse, seine Datenpunkte sind die Instanzen.**
Pro verwendetem **dpType** wird genau **eine** SDM-Klasse erzeugt, und die DPs
sind deren Instanzen — gesteuert über `adoptDataPoints`:

- **`adopt` (Default):** der bestehende dpType wird als SDM-Klasse registriert
  (`mappedDpType` = der **echte** OA-Typ) und einmalig per `dpTypeChange` um die
  eingebettete `sem`-Struct erweitert. Die **echten DPs sind dann die Instanzen**
  (`getClassByDpType`/`listInstances` erkennen sie) und hängen per `isa:partOf`
  unter ihrem Knoten. → verändert diese dpTypes (und damit alle ihre DPs) einmalig.
- **`proxy` (nicht-invasiv):** pro dpType eine eigene `oa:dp:<typ>`-Klasse + je DP
  eine leichte Referenzinstanz (`dpRef`). Die echten Typen/DPs bleiben unangetastet.

> Da `isa:partOf` funktional (0..1) ist, gehört ein DP genau zu **einem** Knoten:
> erscheint ein DP in mehreren Summenalarmen, beansprucht ihn der zuerst
> verarbeitete Knoten.

---

## 4. Migration durchführen

Drei gleichwertige Wege — jeder mit **Dry-run** (Plan, schreibt nichts) und
**Apply**. Immer zuerst Dry-run, Plan prüfen, dann Apply.

### 4.1 Über die WebUI (empfohlen)

1. `/sdm` öffnen → Button **„Mass engineering"** (Statusleiste).
2. Tab **„WinCC OA"**.
3. Checkbox **„Include data-point assignment (sum-alarms)"** setzen/lassen.
4. **Dry-run** → Plan-Tabelle prüfen (Knoten, Parents, abgeleitete Summenalarm-DPs,
   Anzahl referenzierter DPs).
5. **Apply** → Ergebnis (angelegte Knoten / DPs / Kanten).
6. Tab *Assets* der Seite zeigt den importierten Baum (ggf. „Reload").

### 4.2 Über den SDM-MCP-Server (für KI/Automatisierung)

```text
sdm-oa-import-plan   { "includeDataPoints": true, "adoptDataPoints": true }   # Dry-run
sdm-oa-import-apply  { "includeDataPoints": true, "adoptDataPoints": true }   # Anwenden
```

### 4.3 Über die WebSocket-API (Frontend/eigene Clients)

```text
sdm.oa.importPlan    { includeDataPoints: true, adoptDataPoints: true }
sdm.oa.importApply   { includeDataPoints: true, adoptDataPoints: true }
```

- `includeDataPoints=false` migriert nur die **Asset-Hierarchie** (Phase 1) ohne
  DP-Zuordnung.
- `adoptDataPoints=false` schaltet die DP-Zuordnung auf den **nicht-invasiven
  Proxy-Modus** um (echte dpTypes/DPs bleiben unangetastet). Default ist `adopt`.

---

## 5. Empfohlener Ablauf

1. **SDM-Manager im Zielprojekt** starten/sicherstellen.
2. **Dry-run** ausführen und Plan prüfen:
   - Stimmt die Knotenzahl mit der Topologie überein?
   - Sind die `parentDp`-Verknüpfungen plausibel (Roots = `parentNumber 0`)?
   - Werden je Bereich Summenalarm-DPs aufgelöst (`nodesWithSumAlert > 0`,
     `dataPoints > 0`)? Falls 0: Abschnitt 7 (Troubleshooting).
3. **Apply** ausführen.
4. **Verifizieren** (Abschnitt 6).
5. Bei Bedarf erneut ausführen — die Migration ist **idempotent**: vorhandene
   Knoten/DPs werden übersprungen, Kanten sind ohnehin idempotent.

---

## 6. Verifizieren

- **WebUI**: `/sdm` → Tab *Assets* → der Baum entspricht der Navigations-/
  Topologie-Struktur; unter den Bereichen hängen die zugeordneten Datenpunkte.
- **MCP/Programmierung**:
  - `sdm-hierarchy-roots` → die Root-Knoten (z. B. „StartPanel").
  - `sdm-hierarchy-children { parentDp: "oaNode_<n>" }` → Kinder lazy.
  - `sdm-instance-get { id: "oaNode_<n>" }` → Properties + Nachbarn.
- **Modell-Linter**: `sdm-validate` → prüft referenzielle Integrität,
  Kardinalität, Adjazenz; sollte nach dem Import 0 Fehler liefern.

---

## 7. Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| Nur 1–3 Knoten, generische Namen | SDM-Manager zeigt aufs falsche Projekt (z. B. Default-Topologie). Importer **im Zielprojekt** ausführen. |
| `dataPoints = 0`, `nodesWithSumAlert = 0` | Summenalarm-DPs nicht gefunden. Prüfen, ob die Knoten echte `fileName` (kein `EXECSCRIPT`, nicht leer) haben und die abgeleiteten `_SumAlertPanel`-DPs existieren (Plan-Spalte „sum-alarm DP"). |
| Einzelne DPs fehlen | Member stammen aus `_dp_list` **und** `_dp_pattern`; ein leeres/ungültiges Pattern wird übersprungen. Pattern im Summenalarm-DP prüfen. |
| Knoten erscheinen nicht im Asset-Tree | Der Asset-Tree zeigt `isa:partOf`-Teilnehmer; Root-Knoten erscheinen, weil `oa:TopologyNode` von `isa:EquipmentElement` erbt. Nach Apply „Reload" drücken / SW-Reset der WebUI. |
| Doppelte/alte Instanzen nach erneutem Lauf | Keine — idempotent. **Vorsicht beim Zurücksetzen im `adopt`-Modus:** `deleteClass(adoptierte dpType-Klasse, deleteInstances=true)` würde den **echten** OA-Typ samt seiner DPs löschen — stattdessen nur die Klassen-Meta-DP entfernen und ggf. `sem` per `dpTypeChange` zurückbauen. `oa:TopologyNode` ist hingegen gefahrlos löschbar. |

> **MCP-Tool-Hinweis:** Das `get-value`-MCP-Tool blockt die Config-Attribut-Syntax
> (`..`) als vermeintlichen Wildcard. Das betrifft nur das Inspektions-Tool — der
> Importer im Manager nutzt `dpGet('dp:_alert_hdl.._dp_list')` direkt und ist davon
> nicht betroffen.

---

## 8. Eigenschaften & Grenzen

- **dpType = Klasse, DP = Instanz:** pro verwendetem dpType genau eine SDM-Klasse.
  - `adopt` (Default): der echte OA-Typ wird zur Klasse (einmalige `sem`-Erweiterung
    des Typs); die echten DPs sind die Instanzen. Original-Werte/-Config bleiben
    unangetastet, nur der Typ bekommt die `sem`-Struct hinzu.
  - `proxy`: vollständig nicht-invasiv (Referenzinstanzen mit `dpRef`).
- **Idempotent:** Mehrfaches Apply ist sicher (Skip bei vorhandenen Instanzen).
- **Redundanz:** Schreibzugriffe nur auf dem aktiven Peer (Standby liefert 503),
  wie alle SDM-Schreiboperationen.
- **Funktionale Containment-Relation:** `isa:partOf` ist 0..1 → ein DP/Knoten hat
  genau einen Parent.
- **Skalierung:** Topologie wird in einem `dpGet` gelesen; Member je Knoten in
  einem `dpGet` + `dpNames(pattern)`. Der Asset-Tree lädt anschließend lazy.

---

## 9. Anpassung / Erweiterung

Im Code (`javascript/sdm/src/model/oaImport.ts`) leicht erweiterbar:

- **Konkrete Subklassen** je `functionality`/`panelType` statt einer einzigen
  `oa:TopologyNode`-Klasse (z. B. `oa:Area`, `oa:ProcessCell`).
- **Property-Metadaten anreichern**: Einheit/Beschreibung/Archiv-Info je Element aus
  dem Common-/Alert-Config der adoptierten Typen ziehen (die Element-Namen werden
  bereits vollständig übernommen).
- **Eigene Containment-Relation** (`oa:monitoredBy`) statt `isa:partOf` für die
  DP-Zuordnung, falls DPs zusätzlich in anderen Hierarchien stehen sollen.
- **Mehrere Topologie-Quellen** (verteilte Systeme) durch System-Präfix-Parameter.

---

## 10. Referenz: Bausteine

| Schicht | Artefakt |
|---|---|
| Model | `javascript/sdm/src/model/oaImport.ts` (`planOaImport`, `applyOaImport`, `sumAlertDpName`) |
| Service | `service.planOaImport` / `service.applyOaImport` |
| WebSocket | `sdm.oa.importPlan` / `sdm.oa.importApply` |
| MCP | `sdm-oa-import-plan` / `sdm-oa-import-apply` |
| UI | Mass-Engineering-Dialog, Tab „WinCC OA" (`sdm-bulk-dialog.ts`) |

# Bugreport: webserver-js — statische Auslieferung ignoriert Suchpfad-Priorität

**Status:** offen · **Schweregrad:** hoch (Projekt-Deployments werden still überschattet)
**Gefunden in:** WinCC OA 3.21, `webserver-js` 1.0.1 (gebündeltes `wsj.js`)
**Reproduziert:** ja (siehe unten)

---

## Komponente
`webserver-js` → Klasse **`WsjFileDownloadLiveDirectoryController`**
Datei: `src/endpoints/static/controllers/wsjFileDownloadLiveDirectoryController.ts` (Konstruktor)

## Symptom
Dateien, die in **mehreren** WinCC-OA-Suchpfaden liegen (z. B. `data/dashboard-wc/menuconfig.json` sowohl im **Projekt** als auch in der **Installation**), werden **nicht-deterministisch** ausgeliefert — teils aus der Installation statt aus dem Projekt. Folge: Projekt-Deployments werden stillschweigend vom Produktverzeichnis **überschattet**.

Konkreter Fall: Ein projektseitig ergänzter Menüpunkt fehlte in der WebUI, weil die **Install**-`menuconfig.json` (ohne den Eintrag) ausgeliefert wurde; projekt-exklusive Dateien (`pages/sdm.js`) kamen dagegen korrekt aus dem Projekt.

## Reproduktion
1. Datei `data/dashboard-wc/menuconfig.json` existiert in Projekt **und** Produktinstallation, mit unterschiedlichem Inhalt.
2. Direktabruf am Server (ohne Browser-Cache):
   ```
   curl -k https://localhost:8443/data/dashboard-wc/menuconfig.json
   ```
   → liefert die **Install**-Version, obwohl die Projekt-Version existiert und höher priorisiert sein müsste.
3. `curl -k https://localhost:8443/data/dashboard-wc/pages/sdm.js` → HTTP 200 aus dem **Projekt** (Datei nur dort vorhanden) — beweist, dass beide Verzeichnisse registriert sind und die Reihenfolge das Problem ist.

## Ursache
`downloadFile()` durchläuft `this.directories` und liefert den **ersten** Treffer (first-match-wins) — das ist korrekt. Der Fehler steckt in der **Befüllung** von `this.directories` im Konstruktor:

```ts
// IST (fehlerhaft)
WsjServerGlobal.winccoa.getPaths().forEach((searchPath) => {
  const dir = path.join(searchPath, basePath);
  fs.stat(dir, (err, stats) => {                      // asynchron!
    if (!err && stats.isDirectory()) {
      this.directories.push(new LiveDirectory(dir, ...liveDirectoryOptions));
    }
  });
});
```

`fs.stat` ist **asynchron**: Die `push`-Reihenfolge folgt der **Callback-/stat-Completion-Reihenfolge** (Dateisystem-Race), **nicht** der von `getPaths()` vorgegebenen Prioritätsreihenfolge (Projekt vor Produkt). Auf schneller Produkt-Platte (C:) „gewinnt" so das Installationsverzeichnis. Die `directories`-Liste ist damit falsch sortiert; der ansonsten korrekte first-match liefert dann die falsche Quelle.

Relevanter Ausschnitt aus `downloadFile()` (korrekt, first-match):

```ts
const rel = req.path.replace(this.basePath, '');
for (const directory of this.directories) {     // Reihenfolge = Priorität
  const file = directory.get(rel);
  if (file !== undefined) { /* ausliefern + return */ }
}
```

## Erwartetes Verhalten
`this.directories` muss **exakt in der Reihenfolge von `WinccoaManager.getPaths()`** befüllt werden (Projekt/Subprojekte vor Produktinstallation), damit der first-match in `downloadFile()` die höchstpriore (Projekt-)Kopie liefert.

## Fix (empfohlen, synchron)
Der Konstruktor läuft genau einmal beim Server-Start — ein paar synchrone `statSync`-Aufrufe sind vernachlässigbar und beseitigen den Race vollständig:

```ts
// SOLL
constructor(basePath: string) {
  this.basePath = basePath;
  // getPaths() liefert die WinCC-OA-Suchpfade in Prioritätsreihenfolge
  // (Projekt/Subprojekte vor Produktinstallation). directories MUSS in
  // genau dieser Reihenfolge befüllt werden, damit der first-match-Lookup
  // in downloadFile() die höchstpriore Kopie zurückgibt.
  for (const searchPath of WsjServerGlobal.winccoa.getPaths()) {
    const dir = path.join(searchPath, basePath);
    try {
      if (fs.statSync(dir).isDirectory()) {
        this.directories.push(
          new LiveDirectory(dir, WsjFileDownloadLiveDirectoryController.liveDirectoryOptions)
        );
      }
    } catch {
      // dieser Suchpfad hat das Verzeichnis nicht — überspringen
    }
  }
}
```

## Fix (Alternative, asynchron & ordnungserhaltend)
Falls synchrone I/O im Konstruktor vermieden werden soll: in **indexgebundene Slots** schreiben und in Index-Reihenfolge anhängen (Init in eine async-Methode auslagern, da Konstruktoren nicht async sein können):

```ts
private async initDirectories(basePath: string): Promise<void> {
  const searchPaths = WsjServerGlobal.winccoa.getPaths();
  const slots = await Promise.all(
    searchPaths.map(async (searchPath) => {            // Promise.all erhält Index-Reihenfolge
      const dir = path.join(searchPath, basePath);
      try {
        return (await fs.promises.stat(dir)).isDirectory()
          ? new LiveDirectory(dir, WsjFileDownloadLiveDirectoryController.liveDirectoryOptions)
          : undefined;
      } catch {
        return undefined;
      }
    })
  );
  for (const ld of slots) if (ld) this.directories.push(ld);   // ordnungserhaltend
}
```

## Tragweite
Betrifft die gesamte verzeichnisbasierte Statik-Auslieferung über diesen Controller (`/data/*`, `/panels/*`, `/scripts/*`, …), wann immer eine Datei in Projekt **und** Installation existiert. Bisher fiel es kaum auf, weil die meisten Dateien nur an einer Stelle liegen — bei Überlappung wird aber die Quelle nicht-deterministisch.

## Test
- Regression: eine Datei mit gleichem relativen Pfad in zwei Suchpfaden (Projekt + Dummy-Produktpfad) anlegen und sicherstellen, dass **immer** die Projekt-Kopie ausgeliefert wird.
- Unit-Test: `directories`-Reihenfolge == `getPaths()`-Reihenfolge.

## Exakter Patch im ausgelieferten Bundle (`wsj.js`, nur als Referenz/Interim)
Im Konstruktor von `WsjFileDownloadLiveDirectoryController`, innerhalb des bestehenden `getPaths().forEach(s=>{const r=n.default.join(s,e); … })`:

```diff
- i.default.stat(r,(e,i)=>{!e&&i.isDirectory()&&this.directories.push(new t.default(r,a.liveDirectoryOptions))})
+ try{i.default.statSync(r).isDirectory()&&this.directories.push(new t.default(r,a.liveDirectoryOptions))}catch(e){}
```

`i.default` = `fs`, `n.default` = `path`, `t.default` = `LiveDirectory`, `a` = die Controller-Klasse. `forEach` bleibt synchron → `push` in `getPaths()`-Reihenfolge.

> Hinweis: Das Install-Verzeichnis ist i. d. R. schreibgeschützt und wird vom nächsten OA-Update überschrieben — der Bundle-Patch ist nur ein Interim; der eigentliche Fix gehört in die `webserver-js`-Quelle.

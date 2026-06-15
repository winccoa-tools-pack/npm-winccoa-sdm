"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setManager = exports.loadTBox = exports.bootstrapSdm = exports.SdmDashboardServer = exports.WsjServerGlobal = void 0;
// -----------------------------------------------------------------------------
// Package entry point (see "main": "dist/index.js"). Re-exports everything
// run.js needs to start the SDM server and bootstrap the meta model.
// -----------------------------------------------------------------------------
var webserver_js_1 = require("webserver-js");
Object.defineProperty(exports, "WsjServerGlobal", { enumerable: true, get: function () { return webserver_js_1.WsjServerGlobal; } });
var sdmDashboardServer_1 = require("./sdmDashboardServer");
Object.defineProperty(exports, "SdmDashboardServer", { enumerable: true, get: function () { return sdmDashboardServer_1.SdmDashboardServer; } });
var bootstrap_1 = require("./bootstrap");
Object.defineProperty(exports, "bootstrapSdm", { enumerable: true, get: function () { return bootstrap_1.bootstrapSdm; } });
var ontology_1 = require("./model/ontology");
Object.defineProperty(exports, "loadTBox", { enumerable: true, get: function () { return ontology_1.loadTBox; } });
var oa_1 = require("./oa");
Object.defineProperty(exports, "setManager", { enumerable: true, get: function () { return oa_1.setManager; } });
//# sourceMappingURL=index.js.map
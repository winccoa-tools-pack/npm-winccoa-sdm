// -----------------------------------------------------------------------------
// Package entry point (see "main": "dist/index.js"). Re-exports everything
// run.js needs to start the SDM server and bootstrap the meta model.
// -----------------------------------------------------------------------------
export { WsjServerGlobal } from 'webserver-js';
export { SdmDashboardServer } from './sdmDashboardServer';
export { bootstrapSdm } from './bootstrap';
export { loadTBox } from './model/ontology';
export { setManager } from './oa';

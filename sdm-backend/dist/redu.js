"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mayWrite = mayWrite;
exports.reduInfo = reduInfo;
// -----------------------------------------------------------------------------
// Redundancy helpers.
//
// The model IS the DP + CNS data, which OA replicates between redundant peers.
// The backend runs on both peers; structural / background writes (bootstrap,
// index maintenance) run only on the currently active host to avoid double
// writes. No model state is kept that could not be rebuilt after a switchover.
// -----------------------------------------------------------------------------
const oa_1 = require("./oa");
/** True when this peer may perform structural / background writes. */
function mayWrite() {
    try {
        if (!(0, oa_1.oa)().isRedundant())
            return true;
        return (0, oa_1.oa)().isReduActive();
    }
    catch {
        return true; // non-redundant / not determinable -> behave as standalone
    }
}
function reduInfo() {
    let redundant = false;
    let active = true;
    try {
        redundant = (0, oa_1.oa)().isRedundant();
        active = redundant ? (0, oa_1.oa)().isReduActive() : true;
    }
    catch {
        /* ignore */
    }
    return { redundant, active };
}
//# sourceMappingURL=redu.js.map
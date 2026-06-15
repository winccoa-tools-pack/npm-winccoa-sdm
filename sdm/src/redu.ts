// -----------------------------------------------------------------------------
// Redundancy helpers.
//
// The model IS the DP + CNS data, which OA replicates between redundant peers.
// The backend runs on both peers; structural / background writes (bootstrap,
// index maintenance) run only on the currently active host to avoid double
// writes. No model state is kept that could not be rebuilt after a switchover.
// -----------------------------------------------------------------------------
import { oa } from './oa';

/** True when this peer may perform structural / background writes. */
export function mayWrite(): boolean {
  try {
    if (!oa().isRedundant()) return true;
    return oa().isReduActive();
  } catch {
    return true; // non-redundant / not determinable -> behave as standalone
  }
}

export function reduInfo(): { redundant: boolean; active: boolean } {
  let redundant = false;
  let active = true;
  try {
    redundant = oa().isRedundant();
    active = redundant ? oa().isReduActive() : true;
  } catch {
    /* ignore */
  }
  return { redundant, active };
}

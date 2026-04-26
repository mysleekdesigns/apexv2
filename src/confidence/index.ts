// Phase 4.2 — confidence calibration.
//
// The calibrator runs AFTER promotion as a separate step. It does NOT replace
// the proposer's initial confidence assignment in src/reflector/proposer.ts.
// On every run it reads signals from .apex/episodes/<id>/{tools,corrections,
// failures,retrievals}.jsonl, aggregates per-entry deltas, and writes back the
// new `confidence` + `last_validated` to each entry's frontmatter.
//
// Idempotence: if no new signals exist (or the existing confidence already
// matches the target derived from signals), no file is touched.

export { runCalibrator, targetConfidenceFromScore, defaultEpisodeIds } from "./calibrator.js";
export {
  aggregateSignals,
  indexEntries,
  jaccard,
  tokenize,
} from "./signals.js";
export type {
  AggregatedSignals,
  CalibrationConfig,
  CalibrationReport,
  CalibrationSignal,
  ConfidenceTransition,
  EntryRef,
  SignalDirection,
  SignalSource,
} from "./types.js";
export { CONFIDENCE_WEIGHT, DEFAULT_CALIBRATION_CONFIG } from "./types.js";

import { CONFIDENCE_WEIGHT } from "./types.js";
import type { Confidence } from "../types/shared.js";

/** Multiplier applied to retrieval scores: low → 0.5, medium → 0.85, high → 1.0. */
export function confidenceWeight(c: Confidence): number {
  return CONFIDENCE_WEIGHT[c];
}

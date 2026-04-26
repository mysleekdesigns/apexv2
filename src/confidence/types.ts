import type { Confidence, KnowledgeType } from "../types/shared.js";

export type SignalDirection = "up" | "down";

export type SignalSource =
  | "test_pass"
  | "repeat_correction"
  | "thumbs_up"
  | "thumbs_down"
  | "contradicting_test"
  | "ignore_directive"
  | "stale";

export interface CalibrationSignal {
  direction: SignalDirection;
  source: SignalSource;
  episodeId: string;
  ref: string;
}

export interface EntryRef {
  id: string;
  type: KnowledgeType;
}

export interface AggregatedSignals {
  entry: EntryRef;
  signals: CalibrationSignal[];
  /** Net score: sum of +1 (up) and -1 (down) across signals. */
  score: number;
}

export interface ConfidenceTransition {
  entry: EntryRef;
  from: Confidence;
  to: Confidence;
  /** Total net signal score that produced the new state. */
  score: number;
  signalCount: number;
  signalsBySource: Partial<Record<SignalSource, number>>;
  /** When false, the entry already matched the target state (no write needed). */
  changed: boolean;
}

export interface CalibrationReport {
  episodesScanned: string[];
  transitions: ConfidenceTransition[];
  /** Files written (empty when dry-run). */
  filesWritten: string[];
  /** Entries skipped because they had no signals. */
  noSignalEntryCount: number;
  dryRun: boolean;
}

export interface CalibrationConfig {
  /** Score (>=) above which an entry is high. Default 2. */
  highThreshold: number;
  /** Score (<=) below which an entry is low. Default -1. */
  lowThreshold: number;
  /** Number of episodes since last retrieval before staleness decay fires. Default 10. */
  staleDecayN: number;
  /** Jaccard threshold for matching corrections to entries. Default 0.4. */
  correctionJaccard: number;
}

export const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.85,
  high: 1.0,
};

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  highThreshold: 2,
  lowThreshold: -1,
  staleDecayN: 10,
  correctionJaccard: 0.4,
};

// Updates episode meta.json to record that reflection has completed.
//
// Sets meta.reflection = { status: "complete", completed_at, proposed_entries }
// and rewrites meta.json atomically (write-then-move is not available in all
// environments; we use fs.writeFile which is safe for single-writer use-cases).

import path from "node:path";
import fs from "fs-extra";
import type { EpisodeMeta } from "../types/shared.js";
import { isEpisodeId } from "../episode/id.js";

export async function markEpisodeReflected(
  root: string,
  episodeId: string,
  proposedIds: string[],
): Promise<void> {
  if (!isEpisodeId(episodeId)) {
    throw new Error(`markEpisodeReflected: invalid episode id: ${episodeId}`);
  }
  const metaFile = path.join(root, ".apex", "episodes", episodeId, "meta.json");
  const meta = JSON.parse(await fs.readFile(metaFile, "utf8")) as EpisodeMeta;

  meta.reflection = {
    status: "complete",
    completed_at: new Date().toISOString(),
    proposed_entries: proposedIds,
  };

  await fs.writeFile(metaFile, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

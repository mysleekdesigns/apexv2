// CLI glue for `apex review` — file I/O around the pure renderer in diff.ts.
//
// Kept separate so tests can drive renderMarkdown / renderJson without spawning
// the CLI or touching the disk.

import path from "node:path";
import fs from "node:fs/promises";
import {
  buildReviewModel,
  renderMarkdown,
  renderJson,
  type ReviewModel,
  type ReviewJson,
} from "./diff.js";

export interface RunReviewOptions {
  /** Project root. Defaults to cwd. */
  cwd?: string;
  /** Write rendered output to this path instead of returning the string. */
  out?: string;
  /** Emit JSON instead of Markdown. */
  json?: boolean;
  /** Run the applies_to lint pass against `.apex/knowledge/`. */
  lint?: boolean;
}

export interface RunReviewResult {
  /** The model we built — handy for tests and JSON output. */
  model: ReviewModel;
  /** What was rendered (Markdown string or JSON.stringify-ed payload). */
  rendered: string;
  /** When --out was provided, the absolute path written to. */
  writtenTo?: string;
  /** When --json was used, the parsed JSON shape. */
  json?: ReviewJson;
}

export async function runReview(opts: RunReviewOptions = {}): Promise<RunReviewResult> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const model = await buildReviewModel({ root, ...(opts.lint ? { lint: true } : {}) });

  let rendered: string;
  let json: ReviewJson | undefined;
  if (opts.json) {
    json = renderJson(model);
    rendered = `${JSON.stringify(json, null, 2)}\n`;
  } else {
    rendered = renderMarkdown(model);
  }

  let writtenTo: string | undefined;
  if (opts.out) {
    writtenTo = path.resolve(root, opts.out);
    await fs.mkdir(path.dirname(writtenTo), { recursive: true });
    await fs.writeFile(writtenTo, rendered, "utf8");
  }

  const result: RunReviewResult = { model, rendered };
  if (writtenTo) result.writtenTo = writtenTo;
  if (json) result.json = json;
  return result;
}

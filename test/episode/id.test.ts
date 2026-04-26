// Episode-id tests. Ensures specs/episode-schema.md §"Episode ID format"
// regex matches and that ids are sortable lexicographically by start time.

import { describe, expect, it } from "vitest";

import {
  EPISODE_ID_REGEX,
  isEpisodeId,
  newEpisodeId,
} from "../../src/episode/id.js";

describe("newEpisodeId", () => {
  it("matches the spec regex", () => {
    for (let i = 0; i < 50; i++) {
      const id = newEpisodeId(new Date());
      expect(id).toMatch(EPISODE_ID_REGEX);
      expect(isEpisodeId(id)).toBe(true);
    }
  });

  it("encodes the supplied UTC date components", () => {
    const d = new Date(Date.UTC(2026, 3, 26, 14, 32, 11)); // 2026-04-26T14:32:11Z
    const id = newEpisodeId(d);
    expect(id.startsWith("2026-04-26-1432-")).toBe(true);
  });

  it("ids are sortable lexicographically by start time", () => {
    const ids: string[] = [];
    const stamps = [
      new Date(Date.UTC(2026, 3, 26, 14, 32, 11)),
      new Date(Date.UTC(2026, 3, 26, 14, 35, 0)),
      new Date(Date.UTC(2026, 3, 26, 15, 0, 0)),
      new Date(Date.UTC(2026, 4, 1, 9, 15, 0)),
    ];
    for (const d of stamps) ids.push(newEpisodeId(d));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it("ids generated in the same minute differ in the hash suffix", () => {
    const d = new Date(Date.UTC(2026, 3, 26, 14, 32, 0));
    const a = newEpisodeId(d);
    const b = newEpisodeId(d);
    // Lead matches; full ids should not (hash suffix is uuidv4-derived).
    expect(a.slice(0, 16)).toBe(b.slice(0, 16));
    // Vanishingly small chance these collide; if they do, the test will be
    // flaky. We accept that probability (~1/65536) as acceptable for a
    // fast-feedback unit test.
    expect(a).not.toBe(b);
  });
});

describe("isEpisodeId", () => {
  it("rejects malformed strings", () => {
    expect(isEpisodeId("")).toBe(false);
    expect(isEpisodeId("not-an-id")).toBe(false);
    expect(isEpisodeId("2026-04-26-14:32-9bc4")).toBe(false);
    expect(isEpisodeId("2026-04-26-1432-9BC4")).toBe(false); // hash must be lowercase
    expect(isEpisodeId("2026-04-26-1432-9bc")).toBe(false); // hash too short
    expect(isEpisodeId("2026-04-26-1432-9bc4z")).toBe(false); // extra chars
  });

  it("accepts the spec example", () => {
    expect(isEpisodeId("2026-04-26-1432-9bc4")).toBe(true);
  });
});

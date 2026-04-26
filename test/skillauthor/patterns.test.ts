import { describe, it, expect } from "vitest";
import { detectPatterns } from "../../src/skillauthor/patterns.js";
import type { EpisodeToolSequence } from "../../src/skillauthor/patterns.js";

function makeSeq(episodeId: string, tools: string[], turns?: number[]): EpisodeToolSequence {
  return {
    episodeId,
    tools,
    turns: turns ?? tools.map((_, i) => i + 1),
  };
}

describe("detectPatterns — basic n-gram detection", () => {
  it("detects a repeated 3-gram across 3 episodes", () => {
    const shape = ["Bash", "Edit", "Bash"];
    const ep1 = makeSeq("2026-04-26-1000-aaaa", shape);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", shape);
    const ep3 = makeSeq("2026-04-26-1200-cccc", shape);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const found = patterns.find(
      (p) => p.shape.join(",") === "bash,edit,bash",
    );
    expect(found).toBeDefined();
    expect(found!.occurrences).toBeGreaterThanOrEqual(3);
  });

  it("does not return patterns below threshold", () => {
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Bash", "Edit", "Bash"]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["Bash", "Edit", "Bash"]);

    const patterns = detectPatterns([ep1, ep2], { threshold: 3 });
    // Only 2 occurrences, below threshold of 3
    const found = patterns.find((p) => p.shape.join(",") === "bash,edit,bash");
    expect(found).toBeUndefined();
  });

  it("detects a 2-gram when it occurs >= threshold times", () => {
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Read", "Edit"]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["Read", "Edit"]);
    const ep3 = makeSeq("2026-04-26-1200-cccc", ["Read", "Edit"]);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const found = patterns.find((p) => p.shape.join(",") === "read,edit");
    expect(found).toBeDefined();
  });

  it("normalizes tool names to lowercase", () => {
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["BASH", "EDIT", "BASH"]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["bash", "edit", "bash"]);
    const ep3 = makeSeq("2026-04-26-1200-cccc", ["Bash", "Edit", "Bash"]);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const found = patterns.find((p) => p.shape.join(",") === "bash,edit,bash");
    expect(found).toBeDefined();
    expect(found!.occurrences).toBeGreaterThanOrEqual(3);
  });

  it("filters out all-Read shapes", () => {
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Read", "Read", "Read"]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["Read", "Read", "Read"]);
    const ep3 = makeSeq("2026-04-26-1200-cccc", ["Read", "Read", "Read"]);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const allRead = patterns.filter((p) => p.shape.every((t) => t === "read"));
    expect(allRead).toHaveLength(0);
  });

  it("requires shape length >= 2", () => {
    // Even if threshold is met, single-tool patterns should not appear
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Bash"]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["Bash"]);
    const ep3 = makeSeq("2026-04-26-1200-cccc", ["Bash"]);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const singleTool = patterns.filter((p) => p.shape.length === 1);
    expect(singleTool).toHaveLength(0);
  });

  it("returns examples with episodeId and startTurn", () => {
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Bash", "Edit"], [1, 2]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["Bash", "Edit"], [3, 4]);
    const ep3 = makeSeq("2026-04-26-1200-cccc", ["Bash", "Edit"], [5, 6]);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const found = patterns.find((p) => p.shape.join(",") === "bash,edit");
    expect(found).toBeDefined();
    expect(found!.examples.length).toBeGreaterThanOrEqual(1);
    for (const ex of found!.examples) {
      expect(typeof ex.episodeId).toBe("string");
      expect(typeof ex.startTurn).toBe("number");
    }
  });
});

describe("detectPatterns — n=5..2 traversal (longest first)", () => {
  it("detects 5-gram when present >= threshold", () => {
    const shape = ["Bash", "Read", "Edit", "Bash", "Write"];
    const ep1 = makeSeq("2026-04-26-1000-aaaa", shape);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", shape);
    const ep3 = makeSeq("2026-04-26-1200-cccc", shape);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const fiveGram = patterns.find((p) => p.shape.length === 5);
    expect(fiveGram).toBeDefined();
    expect(fiveGram!.occurrences).toBeGreaterThanOrEqual(3);
  });

  it("detects 4-gram patterns", () => {
    const shape = ["Bash", "Read", "Edit", "Bash"];
    const ep1 = makeSeq("2026-04-26-1000-aaaa", shape);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", shape);
    const ep3 = makeSeq("2026-04-26-1200-cccc", shape);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const fourGram = patterns.find(
      (p) => p.shape.length === 4 && p.shape[0] === "bash",
    );
    expect(fourGram).toBeDefined();
  });

  it("sorts results: length DESC then occurrences DESC", () => {
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Bash", "Edit", "Bash", "Edit"]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["Bash", "Edit", "Bash", "Edit"]);
    const ep3 = makeSeq("2026-04-26-1200-cccc", ["Bash", "Edit", "Bash", "Edit"]);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    for (let i = 1; i < patterns.length; i++) {
      const prev = patterns[i - 1]!;
      const curr = patterns[i]!;
      if (prev.shape.length === curr.shape.length) {
        expect(prev.occurrences).toBeGreaterThanOrEqual(curr.occurrences);
      } else {
        expect(prev.shape.length).toBeGreaterThan(curr.shape.length);
      }
    }
  });
});

describe("detectPatterns — sub-pattern deduplication", () => {
  it("removes sub-patterns when longer pattern has same occurrence count", () => {
    // Create exact same sequence in 3 episodes: ["Bash","Edit","Bash"]
    // This means both ["bash","edit","bash"] (3-gram) and its sub-2-grams
    // will have the same occurrence count.
    const shape = ["Bash", "Edit", "Bash"];
    const ep1 = makeSeq("2026-04-26-1000-aaaa", shape);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", shape);
    const ep3 = makeSeq("2026-04-26-1200-cccc", shape);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });

    const threeGram = patterns.find(
      (p) => p.shape.length === 3 && p.shape.join(",") === "bash,edit,bash",
    );
    expect(threeGram).toBeDefined();

    // Sub-2-grams (bash,edit) and (edit,bash) that have the SAME count as the
    // 3-gram should be removed
    const subPatterns = patterns.filter(
      (p) =>
        p.shape.length === 2 &&
        (p.shape.join(",") === "bash,edit" || p.shape.join(",") === "edit,bash"),
    );
    // If they exist, their occurrences should differ from the 3-gram's occurrences
    for (const sub of subPatterns) {
      expect(sub.occurrences).not.toBe(threeGram!.occurrences);
    }
  });

  it("keeps sub-patterns with different occurrence counts", () => {
    // 2-gram "bash,edit" appears in more contexts than 3-gram "bash,edit,bash"
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Bash", "Edit", "Bash", "Bash", "Edit"]);
    const ep2 = makeSeq("2026-04-26-1100-bbbb", ["Bash", "Edit", "Bash", "Bash", "Edit"]);
    const ep3 = makeSeq("2026-04-26-1200-cccc", ["Bash", "Edit", "Bash", "Bash", "Edit"]);

    const patterns = detectPatterns([ep1, ep2, ep3], { threshold: 3 });
    const bashEdit = patterns.find(
      (p) => p.shape.length === 2 && p.shape.join(",") === "bash,edit",
    );
    const bashEditBash = patterns.find(
      (p) => p.shape.length === 3 && p.shape.join(",") === "bash,edit,bash",
    );

    // bash,edit appears twice per episode (positions 0 and 3), so 6 total
    // bash,edit,bash appears once per episode, so 3 total — different counts
    if (bashEdit && bashEditBash) {
      expect(bashEdit.occurrences).not.toBe(bashEditBash.occurrences);
    }
  });
});

describe("detectPatterns — limit", () => {
  it("caps results to the specified limit", () => {
    // Create many distinct patterns
    const makeEp = (id: string, tools: string[]) => makeSeq(id, tools);
    const sequences = [];
    for (let i = 0; i < 3; i++) {
      sequences.push(
        makeEp(`2026-04-26-100${i}-aaaa`, [
          "Bash", "Edit", "Read", "Bash", "Edit",
          "Write", "Bash", "Read", "Edit", "Bash",
        ]),
      );
    }

    const patterns = detectPatterns(sequences, { threshold: 3, limit: 3 });
    expect(patterns.length).toBeLessThanOrEqual(3);
  });

  it("returns empty array for empty input", () => {
    const patterns = detectPatterns([], { threshold: 3 });
    expect(patterns).toHaveLength(0);
  });

  it("returns empty array when no episode has enough tools for n=2", () => {
    const ep1 = makeSeq("2026-04-26-1000-aaaa", ["Bash"]);
    const patterns = detectPatterns([ep1], { threshold: 1 });
    expect(patterns).toHaveLength(0);
  });
});

describe("detectPatterns — window sliding within a single episode", () => {
  it("counts multiple occurrences of same n-gram within one episode", () => {
    // "bash,edit" appears 3 times in a single long episode
    const ep1 = makeSeq("2026-04-26-1000-aaaa", [
      "Bash", "Edit", "Bash", "Edit", "Bash", "Edit",
    ]);

    const patterns = detectPatterns([ep1], { threshold: 3 });
    const bashEdit = patterns.find(
      (p) => p.shape.length === 2 && p.shape.join(",") === "bash,edit",
    );
    expect(bashEdit).toBeDefined();
    expect(bashEdit!.occurrences).toBeGreaterThanOrEqual(3);
  });
});

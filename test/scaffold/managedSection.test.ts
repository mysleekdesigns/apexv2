import { describe, it, expect } from "vitest";
import {
  spliceMarkdownManaged,
  extractMarkdownManaged,
  removeMarkdownManaged,
  spliceGitignoreManaged,
  removeGitignoreManaged,
  spliceSettingsHooks,
  removeSettingsHooks,
  spliceMcpServers,
  removeMcpServer,
} from "../../src/scaffold/managedSection.js";
import { APEX_MANAGED_BEGIN, APEX_MANAGED_END } from "../../src/types/shared.js";

describe("markdown managed section", () => {
  it("inserts a managed block into an empty file", () => {
    const r = spliceMarkdownManaged("", "Hello");
    expect(r.hadExisting).toBe(false);
    expect(r.content).toContain(APEX_MANAGED_BEGIN);
    expect(r.content).toContain("Hello");
    expect(r.content).toContain(APEX_MANAGED_END);
  });

  it("appends a managed block to a file without one, preserving prior content", () => {
    const existing = "# My project\n\nUser content here.\n";
    const r = spliceMarkdownManaged(existing, "Body");
    expect(r.hadExisting).toBe(false);
    expect(r.content.startsWith("# My project")).toBe(true);
    expect(r.content).toContain("Body");
  });

  it("replaces an existing managed block without touching surrounding content", () => {
    const start = `# Title\n\nUser stuff\n${APEX_MANAGED_BEGIN}\nold\n${APEX_MANAGED_END}\n\nMore user stuff\n`;
    const r = spliceMarkdownManaged(start, "new body");
    expect(r.hadExisting).toBe(true);
    expect(r.content).toContain("User stuff");
    expect(r.content).toContain("More user stuff");
    expect(r.content).toContain("new body");
    expect(r.content).not.toContain("old");
  });

  it("round-trips extract -> splice", () => {
    const body = "managed content";
    const r = spliceMarkdownManaged("", body);
    expect(extractMarkdownManaged(r.content)).toBe(body);
  });

  it("removes the managed block and leaves the rest", () => {
    const start = `# Title\n\n${APEX_MANAGED_BEGIN}\nx\n${APEX_MANAGED_END}\n\nKeep me\n`;
    const cleaned = removeMarkdownManaged(start);
    expect(cleaned).not.toContain(APEX_MANAGED_BEGIN);
    expect(cleaned).toContain("Keep me");
  });
});

describe("gitignore managed section", () => {
  it("appends a managed block to an existing .gitignore", () => {
    const r = spliceGitignoreManaged("node_modules\n.env\n", [
      "CLAUDE.local.md",
      ".apex/episodes/",
    ]);
    expect(r.hadExisting).toBe(false);
    expect(r.content).toContain("node_modules");
    expect(r.content).toContain(".env");
    expect(r.content).toContain("CLAUDE.local.md");
    expect(r.content).toContain("# apex:begin");
  });

  it("replaces a prior apex block on re-run", () => {
    const first = spliceGitignoreManaged("a\n", ["b"]);
    const second = spliceGitignoreManaged(first.content, ["c", "d"]);
    expect(second.hadExisting).toBe(true);
    expect(second.content).toContain("a");
    expect(second.content).not.toContain("\nb\n");
    expect(second.content).toContain("c");
  });

  it("removes the apex block cleanly", () => {
    const start = spliceGitignoreManaged("user-line\n", ["x"]).content;
    const cleaned = removeGitignoreManaged(start);
    expect(cleaned).toContain("user-line");
    expect(cleaned).not.toContain("# apex:begin");
  });
});

describe("settings.json managed hooks", () => {
  it("merges apex hooks alongside user hooks", () => {
    const existing = {
      hooks: {
        SessionStart: [
          { matcher: "", hooks: [{ type: "command", command: "echo user" }] },
        ],
      },
      permissions: { allow: ["Bash(ls)"] },
    };
    const merged = spliceSettingsHooks(existing, {
      SessionStart: [
        { matcher: "", hooks: [{ type: "command", command: "apex hook" }] },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "apex post" }],
        },
      ],
    });
    const sessionHooks = (merged["hooks"] as Record<string, unknown[]>)[
      "SessionStart"
    ] as unknown[];
    expect(sessionHooks).toHaveLength(2);
    const apexEntry = sessionHooks.find(
      (h) => (h as Record<string, unknown>)["_apex_managed"] === true,
    );
    expect(apexEntry).toBeDefined();
    expect(merged["permissions"]).toBeDefined();
  });

  it("re-running splice removes prior apex entries (no duplication)", () => {
    const initial = spliceSettingsHooks(null, {
      SessionStart: [
        { matcher: "", hooks: [{ type: "command", command: "v1" }] },
      ],
    });
    const updated = spliceSettingsHooks(initial, {
      SessionStart: [
        { matcher: "", hooks: [{ type: "command", command: "v2" }] },
      ],
    });
    const arr = (updated["hooks"] as Record<string, unknown[]>)[
      "SessionStart"
    ] as unknown[];
    expect(arr).toHaveLength(1);
    const cmd = (arr[0] as Record<string, unknown>)["hooks"] as Array<
      Record<string, unknown>
    >;
    expect(cmd[0]?.["command"]).toBe("v2");
  });

  it("removeSettingsHooks strips apex entries but preserves user entries", () => {
    const merged = spliceSettingsHooks(
      {
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "user" }] },
          ],
        },
      },
      {
        SessionStart: [
          { matcher: "", hooks: [{ type: "command", command: "apex" }] },
        ],
      },
    );
    const cleaned = removeSettingsHooks(merged);
    const arr = (cleaned["hooks"] as Record<string, unknown[]>)[
      "SessionStart"
    ] as unknown[];
    expect(arr).toHaveLength(1);
    expect(
      ((arr[0] as Record<string, unknown>)["hooks"] as Array<Record<string, unknown>>)[0]?.[
        "command"
      ],
    ).toBe("user");
  });
});

describe(".mcp.json managed entries", () => {
  it("preserves user MCP servers and tags apex entry", () => {
    const merged = spliceMcpServers(
      { mcpServers: { other: { command: "x" } } },
      "apex",
      { command: "node" },
    );
    const servers = merged["mcpServers"] as Record<string, unknown>;
    expect(servers["other"]).toEqual({ command: "x" });
    expect((servers["apex"] as Record<string, unknown>)["_apex_managed"]).toBe(true);
  });

  it("removeMcpServer strips only the apex-tagged entry", () => {
    const merged = spliceMcpServers(
      { mcpServers: { other: { command: "x" } } },
      "apex",
      { command: "node" },
    );
    const cleaned = removeMcpServer(merged, "apex");
    const servers = cleaned["mcpServers"] as Record<string, unknown>;
    expect(servers["apex"]).toBeUndefined();
    expect(servers["other"]).toEqual({ command: "x" });
  });
});

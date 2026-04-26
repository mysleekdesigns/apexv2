import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import {
  buildManifest,
  renderManifest,
  packageRoot,
  type PluginManifest,
} from "../../src/plugin/manifest.js";

async function tmpPkg(pkg: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-manifest-"));
  await fs.writeJson(path.join(dir, "package.json"), pkg, { spaces: 2 });
  return dir;
}

describe("plugin manifest", () => {
  let cleanup: string[] = [];

  beforeEach(() => {
    cleanup = [];
  });

  afterEach(async () => {
    await Promise.all(cleanup.map((p) => fs.remove(p).catch(() => {})));
  });

  it("pulls name and version from package.json", async () => {
    const dir = await tmpPkg({
      name: "apex-cc",
      version: "1.2.3",
      description: "self-learning thing",
      author: "Jane Doe <jane@example.com>",
    });
    cleanup.push(dir);

    const m = await buildManifest({}, dir);
    expect(m.name).toBe("apex"); // -cc suffix stripped
    expect(m.version).toBe("1.2.3");
    expect(m.description).toBe("self-learning thing");
    expect(m.author.name).toBe("Jane Doe <jane@example.com>");
  });

  it("strips scope from scoped package names", async () => {
    const dir = await tmpPkg({ name: "@anthropic/apex-cc", version: "0.1.0" });
    cleanup.push(dir);
    const m = await buildManifest({}, dir);
    expect(m.name).toBe("apex");
  });

  it("falls back to defaults when package.json is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-manifest-empty-"));
    cleanup.push(dir);
    const m = await buildManifest({}, dir);
    expect(m.name).toBe("apex");
    expect(m.version).toBe("0.0.0");
    expect(m.description).toContain("APEX");
    expect(m.author.name).toBe("APEX maintainers");
  });

  it("respects explicit overrides over package.json values", async () => {
    const dir = await tmpPkg({ name: "apex-cc", version: "1.0.0" });
    cleanup.push(dir);
    const m = await buildManifest(
      {
        name: "custom-plugin",
        version: "9.9.9",
        description: "override",
        author: { name: "Bot", email: "bot@example.com" },
      },
      dir,
    );
    expect(m.name).toBe("custom-plugin");
    expect(m.version).toBe("9.9.9");
    expect(m.description).toBe("override");
    expect(m.author.email).toBe("bot@example.com");
  });

  it("normalizes object-shaped author entries", async () => {
    const dir = await tmpPkg({
      name: "apex-cc",
      version: "1.0.0",
      author: { name: "Team APEX", url: "https://example.com" },
    });
    cleanup.push(dir);
    const m = await buildManifest({}, dir);
    expect(m.author.name).toBe("Team APEX");
    expect(m.author.url).toBe("https://example.com");
  });

  it("emits the conventional plugin layout pointers", async () => {
    const dir = await tmpPkg({ name: "apex-cc", version: "1.0.0" });
    cleanup.push(dir);
    const m = await buildManifest({}, dir);
    expect(m.hooks).toBe("./hooks");
    expect(m.skills).toBe("./skills");
    expect(m.agents).toBe("./agents");
    expect(m.commands).toBe("./commands");
    expect(m.mcp).toBe("./.mcp.json");
  });

  it("renderManifest produces valid trailing-newline JSON", async () => {
    const m: PluginManifest = {
      name: "apex",
      version: "1.0.0",
      description: "x",
      author: { name: "A" },
      hooks: "./hooks",
      skills: "./skills",
      agents: "./agents",
      commands: "./commands",
      mcp: "./.mcp.json",
    };
    const out = renderManifest(m);
    expect(out.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out) as PluginManifest;
    expect(parsed.name).toBe("apex");
  });

  it("packageRoot points to a directory containing this repo's package.json", async () => {
    const root = packageRoot();
    expect(await fs.pathExists(path.join(root, "package.json"))).toBe(true);
  });

  it("buildManifest with no args reads this repo's actual package.json", async () => {
    const m = await buildManifest();
    expect(m.name).toBe("apex");
    expect(m.version).toMatch(/^\d/);
  });
});

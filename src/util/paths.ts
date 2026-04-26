// Resolve well-known APEX paths inside a target project.

import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ProjectPaths {
  root: string;
  claudeMd: string;
  claudeLocalMd: string;
  claudeDir: string;
  settingsJson: string;
  rulesDir: string;
  skillsDir: string;
  agentsDir: string;
  hooksDir: string;
  mcpJson: string;
  apexDir: string;
  installJson: string;
  configToml: string;
  knowledgeDir: string;
  proposedDir: string;
  episodesDir: string;
  indexDir: string;
  metricsDir: string;
  apexGitignore: string;
  rootGitignore: string;
}

export function projectPaths(root: string): ProjectPaths {
  const r = path.resolve(root);
  const claudeDir = path.join(r, ".claude");
  const apexDir = path.join(r, ".apex");
  return {
    root: r,
    claudeMd: path.join(r, "CLAUDE.md"),
    claudeLocalMd: path.join(r, "CLAUDE.local.md"),
    claudeDir,
    settingsJson: path.join(claudeDir, "settings.json"),
    rulesDir: path.join(claudeDir, "rules"),
    skillsDir: path.join(claudeDir, "skills"),
    agentsDir: path.join(claudeDir, "agents"),
    hooksDir: path.join(claudeDir, "hooks"),
    mcpJson: path.join(r, ".mcp.json"),
    apexDir,
    installJson: path.join(apexDir, "install.json"),
    configToml: path.join(apexDir, "config.toml"),
    knowledgeDir: path.join(apexDir, "knowledge"),
    proposedDir: path.join(apexDir, "proposed"),
    episodesDir: path.join(apexDir, "episodes"),
    indexDir: path.join(apexDir, "index"),
    metricsDir: path.join(apexDir, "metrics"),
    apexGitignore: path.join(apexDir, ".gitignore"),
    rootGitignore: path.join(r, ".gitignore"),
  };
}

/** Absolute path to the package's `templates/` directory (works in source + dist). */
export function templatesDir(): string {
  // src/util/paths.ts -> repo/src/util/paths.ts (dev) or repo/dist/util/paths.js (built).
  // Templates are shipped at repo/templates/.
  const here = fileURLToPath(import.meta.url);
  // Walk up: util -> src or dist -> repo root -> templates
  return path.resolve(path.dirname(here), "..", "..", "templates");
}

import kleur from "kleur";

export function permissionsBanner(): string {
  return [
    "APEX will:",
    "  • Write to: CLAUDE.md, .claude/, .mcp.json, .apex/, .gitignore",
    "  • Install 6 hooks: SessionStart, UserPromptSubmit, PostToolUse,",
    "                    PostToolUseFailure, PreCompact, SessionEnd",
    "  • Register 1 MCP server: apex-mcp (stdio, local-only, no network)",
    "  • Run 1 background subagent once: apex-archaeologist (reads git, README, tests)",
    "  • Make zero network calls. `apex audit` proves this.",
    "",
    "Continue? [y/N]",
  ].join("\n");
}

export function printPermissionsBanner(): void {
  process.stdout.write(`${kleur.bold(permissionsBanner())}\n`);
}

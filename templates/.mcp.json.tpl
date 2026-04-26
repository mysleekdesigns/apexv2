{
  "mcpServers": {
    "apex": {
      "_apex_managed": true,
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/apex-cc/dist/mcp/server-bin.js"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
}

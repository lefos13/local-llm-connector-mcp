const fs = require('fs');
const path = require('path');

/* Antigravity plugin flow.
   Generates the plugin layout expected by the Antigravity client:
     plugin/antigravity/plugin.json                       (manifest at root)
     plugin/antigravity/skills/local-test-verdict/SKILL.md
   This is the original, minimal flow. For the Claude Code plugin (which also
   ships an MCP server registration and a local marketplace) see
   generate-plugin-claude.js. */

const rootDir = path.resolve(__dirname, '..');
const pluginDir = path.join(rootDir, 'plugin', 'antigravity');
const skillsDir = path.join(pluginDir, 'skills', 'local-test-verdict');

console.log('Generating Antigravity plugin structure...');

try {
  // 1. Create directories
  fs.mkdirSync(skillsDir, { recursive: true });

  // 2. Write plugin.json
  const pluginJson = {
    "name": "local-tester",
    "version": "1.0.0",
    "description": "Local test execution, verification, and LLM-based triage plugin for Antigravity",
    "author": {
      "name": "Antigravity Developer"
    },
    "license": "Apache-2.0",
    "keywords": [
      "local-test",
      "mcp",
      "verdict",
      "triage",
      "validation"
    ]
  };
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(pluginJson, null, 2) + '\n'
  );

  // 3. Copy skill-example.md to SKILL.md
  const sourceSkill = path.join(rootDir, 'skill', 'skill-example.md');
  const destSkill = path.join(skillsDir, 'SKILL.md');

  if (fs.existsSync(sourceSkill)) {
    fs.copyFileSync(sourceSkill, destSkill);
    console.log('Antigravity plugin generated successfully under plugin/antigravity/');
  } else {
    console.error(`Error: Source skill file not found at ${sourceSkill}`);
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to generate Antigravity plugin:', error);
  process.exit(1);
}

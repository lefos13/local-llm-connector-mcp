const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pluginDir = path.join(rootDir, 'plugin');
const skillsDir = path.join(pluginDir, 'skills', 'local-test-verdict');

console.log('Generating plugin structure...');

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
    console.log('Plugin generated successfully under plugin/');
  } else {
    console.error(`Error: Source skill file not found at ${sourceSkill}`);
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to generate plugin:', error);
  process.exit(1);
}

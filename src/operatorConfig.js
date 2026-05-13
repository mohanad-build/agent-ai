// src/operatorConfig.js
//
// Loads operator configs from operators/<operatorId>.json.
// Mirrors the loadAgent pattern in src/agentConfig.js, scoped to operators.

const fs   = require('fs');
const path = require('path');

const OPERATOR_FILE_BLOCKLIST = new Set(['example.json']);

function loadOperator(operatorId) {
  const filePath = path.resolve(__dirname, '..', 'operators', `${operatorId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Operator config not found: ${operatorId} (looked for ${filePath})`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function discoverOperatorIds() {
  const operatorsDir = path.join(__dirname, '..', 'operators');
  if (!fs.existsSync(operatorsDir)) return [];
  return fs
    .readdirSync(operatorsDir)
    .filter(f => f.endsWith('.json') && !OPERATOR_FILE_BLOCKLIST.has(f))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

module.exports = { loadOperator, discoverOperatorIds };

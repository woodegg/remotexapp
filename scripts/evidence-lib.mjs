const evidenceKinds = new Set(['audit', 'candidate', 'integration', 'uat', 'publication', 'alignment', 'security']);
const evidenceResults = new Set(['completed', 'passed', 'failed']);
const scenarioResults = new Set(['passed', 'failed', 'skipped']);

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function requireTimestamp(value, field) {
  requireString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC3339 UTC timestamp`);
  }
}

export function validateEvidence(value, source = 'evidence') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  if (value.schemaVersion !== 'remotexapp/evidence/v1') {
    throw new Error(`${source}.schemaVersion must be remotexapp/evidence/v1`);
  }
  if (!evidenceKinds.has(value.kind)) {
    throw new Error(`${source}.kind is unsupported`);
  }
  requireString(value.runId, `${source}.runId`);
  if (typeof value.commit !== 'string' || !/^[0-9a-f]{40}$/.test(value.commit)) {
    throw new Error(`${source}.commit must be a full lowercase Git commit SHA`);
  }
  requireTimestamp(value.startedAt, `${source}.startedAt`);
  requireTimestamp(value.completedAt, `${source}.completedAt`);
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    throw new Error(`${source}.completedAt precedes startedAt`);
  }
  if (!evidenceResults.has(value.result)) {
    throw new Error(`${source}.result is unsupported`);
  }
  if (!value.toolchain || typeof value.toolchain !== 'object' || Array.isArray(value.toolchain)) {
    throw new Error(`${source}.toolchain must be an object`);
  }
  requireString(value.toolchain.go, `${source}.toolchain.go`);
  if (!value.environment || typeof value.environment !== 'object' || Array.isArray(value.environment)) {
    throw new Error(`${source}.environment must be an object`);
  }
  requireString(value.environment.kind, `${source}.environment.kind`);
  requireString(value.environment.name, `${source}.environment.name`);
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    throw new Error(`${source}.scenarios must be a non-empty array`);
  }
  const scenarioIDs = new Set();
  for (const [index, scenario] of value.scenarios.entries()) {
    const prefix = `${source}.scenarios[${index}]`;
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      throw new Error(`${prefix} must be an object`);
    }
    requireString(scenario.id, `${prefix}.id`);
    if (scenarioIDs.has(scenario.id)) {
      throw new Error(`${source} repeats scenario id ${scenario.id}`);
    }
    scenarioIDs.add(scenario.id);
    if (!scenarioResults.has(scenario.result)) {
      throw new Error(`${prefix}.result is unsupported`);
    }
    if (scenario.durationMs !== undefined && (!Number.isFinite(scenario.durationMs) || scenario.durationMs < 0)) {
      throw new Error(`${prefix}.durationMs must be non-negative`);
    }
  }
  if (value.artifact !== undefined) {
    if (!value.artifact || typeof value.artifact !== 'object' || Array.isArray(value.artifact)) {
      throw new Error(`${source}.artifact must be an object`);
    }
    requireString(value.artifact.name, `${source}.artifact.name`);
    if (typeof value.artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.artifact.sha256)) {
      throw new Error(`${source}.artifact.sha256 must be lowercase SHA-256`);
    }
  }
  if (['candidate', 'publication', 'alignment'].includes(value.kind) && value.artifact === undefined) {
    throw new Error(`${source}.artifact is required for ${value.kind} evidence`);
  }
  return value;
}

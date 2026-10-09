const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const schema = require("../../schemas/sources.schema.json");

const PILLARS = schema.$defs.source.properties.pillars.items.enum;

function resolveOutputRoot({ projectRoot, source, dataset, pillar, outputRoot }) {
  const assigned = source.pillars;
  if (!Array.isArray(assigned) || assigned.length === 0 ||
      assigned.some((id) => !PILLARS.includes(id))) {
    throw new Error("Source must have recognized Pillar assignments");
  }
  if (pillar !== undefined && !assigned.includes(pillar)) {
    throw new Error(`Source '${source.id}' is not assigned to Pillar '${pillar}'`);
  }
  if (outputRoot !== undefined) return path.resolve(outputRoot);
  const selected = pillar ?? (assigned.length === 1 ? assigned[0] : undefined);
  if (!selected) throw new Error("Multi-Pillar sources require --pillar or --output");
  if (typeof dataset !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(dataset)) {
    throw new Error("Dataset must be a simple directory name");
  }
  return path.join(path.resolve(projectRoot), "pillars", selected, "processed", dataset);
}

function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return jsonFiles(file);
      return entry.isFile() && entry.name.endsWith(".json") ? [file] : [];
    });
}

function discoverProcessedRecords(projectRoot) {
  return {
    records: PILLARS.flatMap((pillar) =>
      jsonFiles(path.join(projectRoot, "pillars", pillar, "processed"))
        .map((file) => ({ file, pillar }))),
    legacyFiles: jsonFiles(path.join(projectRoot, "processed"))
  };
}

function assertPillarMembership(source, pillar) {
  if (!PILLARS.includes(pillar) || !source.pillars.includes(pillar)) {
    throw new Error(`Source '${source.id}' is not assigned to containing Pillar '${pillar}'`);
  }
}

function checkRecordCopy(seen, record, file) {
  const primary = record.provenance.inputs.find((input) => input.role === "primary");
  const key = JSON.stringify([
    record.provenance.sourceId, record.provenance.repository,
    primary.path, record.provenance.commit
  ]);
  const previous = seen.get(key);
  if (previous && !isDeepStrictEqual(previous.record, record)) {
    throw new Error(`Conflicting copy of source document and commit; first copy: ${previous.file}`);
  }
  if (!previous) seen.set(key, { record, file });
}

module.exports = {
  PILLARS, resolveOutputRoot, discoverProcessedRecords,
  assertPillarMembership, checkRecordCopy
};

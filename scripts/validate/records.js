const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const root = path.resolve(__dirname, "../..");
const processedRoot = path.join(root, "processed");
const registry = JSON.parse(fs.readFileSync(path.join(root, "sources.json"), "utf8"));
const recordSchema = JSON.parse(
  fs.readFileSync(path.join(root, "schemas", "processed-record.schema.json"), "utf8")
);

function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
  });
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRecord = ajv.compile(recordSchema);
const metadataValidators = new Map();

function sha256(text) {
  return `sha256:${crypto.createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function recordError(file, message) {
  failed = true;
  console.error(`Processed record is inconsistent: ${path.relative(root, file)}`);
  console.error(`  ${message}`);
}

for (const source of registry.sources) {
  if (!source.adapter) continue;
  const schemaPath = path.resolve(root, source.adapter.metadataSchema);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  metadataValidators.set(source.adapter.metadataNamespace, ajv.compile(schema));
}

let failed = false;
const files = jsonFiles(processedRoot);
for (const file of files) {
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!validateRecord(record)) {
    failed = true;
    console.error(`Processed record failed common validation: ${path.relative(root, file)}`);
    for (const error of validateRecord.errors ?? []) {
      console.error(`  ${error.instancePath || "/"}: ${error.message}`);
    }
    continue;
  }

  const source = registry.sources.find((entry) => entry.id === record.provenance.sourceId);
  if (!source) {
    recordError(file, `unknown source id '${record.provenance.sourceId}'`);
    continue;
  }
  if (record.provenance.repository !== source.repository) {
    recordError(file, "provenance repository does not match the source registry");
  }
  if (record.provenance.sourceType !== source.sourceType) {
    recordError(file, "provenance source type does not match the source registry");
  }
  if (
    !source.adapter ||
    record.sourceMetadata.namespace !== source.adapter.metadataNamespace
  ) {
    recordError(file, "source metadata namespace does not match the registered adapter");
  }

  const primary = record.provenance.inputs.find((input) => input.role === "primary");
  if (!primary.path.startsWith(`${source.contentPath}/`)) {
    recordError(file, "primary source path is outside the registered content path");
  }
  if (primary.sha256 !== record.content.original.sha256) {
    recordError(file, "primary input hash does not match original content hash");
  }
  if (record.content.original.sha256 !== sha256(record.content.original.text)) {
    recordError(file, "original content hash does not match its UTF-8 text");
  }
  if (record.content.normalized.sha256 !== sha256(record.content.normalized.text)) {
    recordError(file, "normalized content hash does not match its UTF-8 text");
  }
  if (JSON.stringify(record.licensing.rules) !== JSON.stringify(source.licensing.rules)) {
    recordError(file, "licensing rules do not match the source registry");
  }

  for (const policyPath of source.licensing.policyPaths) {
    const policy = record.licensing.policyFiles.find((entry) => entry.path === policyPath);
    const provenanceInput = record.provenance.inputs.find(
      (entry) => entry.role === "license" && entry.path === policyPath
    );
    if (!policy || !provenanceInput || policy.sha256 !== provenanceInput.sha256) {
      recordError(file, `license policy provenance is incomplete for '${policyPath}'`);
    }
  }

  const validateMetadata = metadataValidators.get(record.sourceMetadata.namespace);
  if (!validateMetadata) {
    failed = true;
    console.error(`No metadata schema registered for '${record.sourceMetadata.namespace}': ${path.relative(root, file)}`);
  } else if (!validateMetadata(record.sourceMetadata)) {
    failed = true;
    console.error(`Processed record failed source metadata validation: ${path.relative(root, file)}`);
    for (const error of validateMetadata.errors ?? []) {
      console.error(`  ${error.instancePath || "/"}: ${error.message}`);
    }
  }
}

if (failed) process.exit(1);
console.log(`\u2713 ${files.length} processed record(s) are valid.`);

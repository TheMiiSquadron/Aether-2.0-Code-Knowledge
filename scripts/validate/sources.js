const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const root = path.resolve(__dirname, "../..");
const sourcesPath = path.join(root, "sources.json");
const schemaPath = path.join(root, "schemas", "sources.schema.json");
const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validate = ajv.compile(schema);
let valid = validate(sources);

if (!valid) {
  console.error("\u2717 sources.json failed schema validation.");
  for (const error of validate.errors ?? []) {
    console.error(`  ${error.instancePath || "/"}: ${error.message}`);
  }
}

const ids = new Set();
const metadataNamespaces = new Set();
for (const source of sources.sources ?? []) {
  if (ids.has(source.id)) {
    valid = false;
    console.error(`\u2717 Duplicate source id: ${source.id}`);
  }
  ids.add(source.id);

  if (!source.adapter) continue;
  if (metadataNamespaces.has(source.adapter.metadataNamespace)) {
    valid = false;
    console.error(`\u2717 Duplicate metadata namespace: ${source.adapter.metadataNamespace}`);
  }
  metadataNamespaces.add(source.adapter.metadataNamespace);

  const metadataSchemaPath = path.resolve(root, source.adapter.metadataSchema);
  const relative = path.relative(root, metadataSchemaPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    valid = false;
    console.error(`\u2717 Metadata schema escapes the project: ${source.adapter.metadataSchema}`);
  } else if (!fs.existsSync(metadataSchemaPath)) {
    valid = false;
    console.error(`\u2717 Metadata schema does not exist: ${source.adapter.metadataSchema}`);
  } else {
    try {
      ajv.compile(JSON.parse(fs.readFileSync(metadataSchemaPath, "utf8")));
    } catch (error) {
      valid = false;
      console.error(`\u2717 Invalid metadata schema ${source.adapter.metadataSchema}: ${error.message}`);
    }
  }
}

if (!valid) process.exit(1);
console.log("\u2713 sources.json and registered metadata schemas are valid.");

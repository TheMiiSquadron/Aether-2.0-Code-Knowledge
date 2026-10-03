const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const root = path.resolve(__dirname, "../..");

const sourcesPath = path.join(root, "sources.json");
const schemaPath = path.join(root, "schemas", "sources.schema.json");

const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv2020({
  allErrors: true,
  strict: true
});

addFormats(ajv);

const validate = ajv.compile(schema);
const valid = validate(sources);

if (valid) {
  console.log("✓ sources.json is valid.");
  process.exit(0);
}

console.error("✗ sources.json failed validation.");

for (const error of validate.errors ?? []) {
  const location = error.instancePath || "/";
  console.error(`  ${location}: ${error.message}`);
}

process.exit(1);
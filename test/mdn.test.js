const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { createRecord, sha256, splitFrontMatter } = require("../scripts/ingest/mdn");

const root = path.resolve(__dirname, "..");
const recordSchema = JSON.parse(
  fs.readFileSync(path.join(root, "schemas/processed-record.schema.json"), "utf8")
);
const mdnSchema = JSON.parse(
  fs.readFileSync(path.join(root, "schemas/source-metadata/mdn.schema.json"), "utf8")
);

function fixtureSource() {
  return {
    id: "mdn",
    sourceType: "git",
    repository: "https://github.com/mdn/content.git",
    licensing: {
      policyPaths: ["LICENSE.md"],
      rules: [
        {
          licenseId: "CC-BY-SA-2.5",
          scope: "prose",
          condition: { kind: "unconditional" }
        }
      ]
    }
  };
}

test("front matter is removed without rewriting the MDN body", () => {
  const source = "---\r\ntitle: Test\r\nslug: Web/Test\r\npage-type: guide\r\n---\r\n\r\nBody {{domxref(\"Window\")}}.\r\n";
  const result = splitFrontMatter(source);
  assert.equal(result.body, "\r\nBody {{domxref(\"Window\")}}.\r\n");
});

test("record preserves exact source content, hashes, provenance, and source metadata", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aether-mdn-test-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const relativePath = "files/en-us/web/test/index.md";
  const absolutePath = path.join(temporaryRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const original = Buffer.from(
    "---\r\ntitle: Test page\r\nshort-title: Test\r\nslug: Web/Test\r\npage-type: guide\r\nbrowser-compat: api.Test\r\nstatus:\r\n  - experimental\r\n---\r\n\r\nExact {{domxref(\"Window\")}} body — unchanged.\r\n\r\n```js\r\nfunction example() {\r\n  if (true) {\r\n    return \"indented\";\r\n  }\r\n}\r\n```\r\n",
    "utf8"
  );
  fs.writeFileSync(absolutePath, original);
  fs.writeFileSync(path.join(temporaryRoot, "LICENSE.md"), "License text\r\n", "utf8");

  const commit = "a".repeat(40);
  const record = createRecord({
    upstreamRoot: temporaryRoot,
    relativePath,
    source: fixtureSource(),
    commit
  });

  assert.equal(record.content.original.text, original.toString("utf8"));
  assert.equal(record.content.original.sha256, sha256(original));
  assert.equal(
    record.content.normalized.text,
    "\r\nExact {{domxref(\"Window\")}} body — unchanged.\r\n\r\n```js\r\nfunction example() {\r\n  if (true) {\r\n    return \"indented\";\r\n  }\r\n}\r\n```\r\n"
  );
  assert.equal(record.content.original.text.includes("—"), true);
  assert.equal(record.content.normalized.text.includes("    return \"indented\";"), true);
  assert.equal(record.provenance.commit, commit);
  assert.equal(record.provenance.inputs[0].path, relativePath);
  assert.deepEqual(record.sourceMetadata.data.browserCompat, ["api.Test"]);
  assert.deepEqual(record.sourceMetadata.data.status, ["experimental"]);
  assert.equal("summary" in record, false);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateRecord = ajv.compile(recordSchema);
  const validateMetadata = ajv.compile(mdnSchema);
  assert.equal(validateRecord(record), true, JSON.stringify(validateRecord.errors));
  assert.equal(validateMetadata(record.sourceMetadata), true, JSON.stringify(validateMetadata.errors));

  const roundTrip = JSON.parse(JSON.stringify(record));
  assert.deepEqual(roundTrip, record);
  assert.equal(roundTrip.content.original.text, original.toString("utf8"));
  assert.equal(roundTrip.content.normalized.text, record.content.normalized.text);
});

const localMdnRoot = path.resolve(root, "../../upstream/mdn");
const localMapPath = "files/en-us/web/javascript/reference/global_objects/array/map/index.md";
const hasLocalMdn =
  fs.existsSync(path.join(localMdnRoot, ".git")) &&
  fs.existsSync(path.join(localMdnRoot, ...localMapPath.split("/")));

test(
  "local MDN integration preserves the upstream Array.prototype.map source",
  { skip: hasLocalMdn ? false : "local upstream/mdn clone is unavailable" },
  () => {
    const registry = JSON.parse(fs.readFileSync(path.join(root, "sources.json"), "utf8"));
    const source = registry.sources.find((entry) => entry.id === "mdn");
    const commit = execFileSync("git", ["-C", localMdnRoot, "rev-parse", "HEAD"], {
      encoding: "utf8"
    }).trim();
    const upstreamText = fs.readFileSync(
      path.join(localMdnRoot, ...localMapPath.split("/")),
      "utf8"
    );
    const expectedBody = splitFrontMatter(upstreamText).body;
    const record = createRecord({
      upstreamRoot: localMdnRoot,
      relativePath: localMapPath,
      source,
      commit
    });

    assert.equal(record.content.original.text, upstreamText);
    assert.equal(record.content.normalized.text, expectedBody);
    assert.equal(record.content.original.text.includes("—"), true);
    assert.equal(
      JSON.parse(JSON.stringify(record)).content.normalized.text,
      expectedBody
    );
  }
);

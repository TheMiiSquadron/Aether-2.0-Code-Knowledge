const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  resolveOutputRoot, discoverProcessedRecords,
  assertPillarMembership, checkRecordCopy
} = require("../scripts/lib/pillar-storage");

const source = { id: "mdn", pillars: ["02-coding"] };

test("routing derives the MDN default from its registered Pillar", () => {
  const projectRoot = path.resolve("fixture");
  assert.equal(resolveOutputRoot({ projectRoot, source, dataset: "mdn-sample" }),
    path.join(projectRoot, "pillars", "02-coding", "processed", "mdn-sample"));
});

test("multi-Pillar routing requires a selection and verifies membership", () => {
  const multi = { id: "mdn", pillars: ["02-coding", "05-research"] };
  const options = { projectRoot: ".", source: multi, dataset: "mdn-sample" };
  assert.throws(() => resolveOutputRoot(options), /require --pillar/);
  assert.equal(resolveOutputRoot({ ...options, pillar: "05-research" }),
    path.resolve("pillars/05-research/processed/mdn-sample"));
  assert.throws(() => resolveOutputRoot({ ...options, pillar: "01-conversation" }),
    /not assigned/);
  assert.throws(() => resolveOutputRoot({
    ...options, source: { id: "bad", pillars: ["../../outside"] }
  }), /recognized/);
});

test("custom output is preserved while an explicit Pillar still requires membership", () => {
  const options = { projectRoot: ".", source, dataset: "mdn-sample", outputRoot: "custom" };
  assert.equal(resolveOutputRoot(options), path.resolve("custom"));
  assert.throws(() => resolveOutputRoot({ ...options, pillar: "05-research" }), /not assigned/);
  assert.throws(() => resolveOutputRoot({
    projectRoot: ".", source, dataset: "../escape"
  }), /simple directory/);
});

test("discovery scans only recognized Pillar processed trees and reports legacy records", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-pillar-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = [
    "pillars/02-coding/processed/mdn-sample/nested/record.json",
    "pillars/05-research/processed/copy.json",
    "pillars/02-coding/unrelated.json",
    "pillars/unknown/processed/record.json",
    "processed/mdn-sample/old.json"
  ];
  for (const relative of paths) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{}");
  }
  const found = discoverProcessedRecords(root);
  assert.deepEqual(found.records.map((entry) => entry.pillar), ["02-coding", "05-research"]);
  assert.deepEqual(found.records.map((entry) => path.relative(root, entry.file)),
    paths.slice(0, 2).map((relative) => path.normalize(relative)));
  assert.deepEqual(found.legacyFiles, [path.join(root, paths[4])]);
  assert.deepEqual(discoverProcessedRecords(path.join(root, "missing")),
    { records: [], legacyFiles: [] });
});

test("record membership must agree with the containing Pillar", () => {
  assert.doesNotThrow(() => assertPillarMembership(source, "02-coding"));
  assert.throws(() => assertPillarMembership(source, "05-research"), /not assigned/);
  assert.throws(() => assertPillarMembership(source, "unknown"), /not assigned/);
});

function fixtureRecord() {
  return {
    id: "mdn:Web/Test",
    provenance: {
      sourceId: "mdn", repository: "https://github.com/mdn/content.git",
      commit: "a".repeat(40),
      inputs: [{ role: "primary", path: "files/en-us/web/test/index.md" }]
    },
    content: { text: "Exact source" }
  };
}

test("identical records across Pillars are permitted independent of object key order", () => {
  const seen = new Map();
  const record = fixtureRecord();
  checkRecordCopy(seen, record, "coding.json");
  const copy = { content: record.content, provenance: record.provenance, id: record.id };
  assert.doesNotThrow(() => checkRecordCopy(seen, copy, "research.json"));
});

test("different content or metadata for the same source document and commit conflicts", () => {
  const seen = new Map();
  const record = fixtureRecord();
  checkRecordCopy(seen, record, "first.json");
  const changed = JSON.parse(JSON.stringify(record));
  changed.content.text = "Changed";
  assert.throws(() => checkRecordCopy(seen, changed, "second.json"), /Conflicting copy/);
  changed.content = record.content;
  changed.id = "mdn:Different";
  assert.throws(() => checkRecordCopy(seen, changed, "third.json"), /Conflicting copy/);
});

test("different commits and source documents are independent records", () => {
  const seen = new Map();
  const record = fixtureRecord();
  checkRecordCopy(seen, record, "first.json");
  const next = JSON.parse(JSON.stringify(record));
  next.provenance.commit = "b".repeat(40);
  assert.doesNotThrow(() => checkRecordCopy(seen, next, "new-commit.json"));
  next.provenance.commit = record.provenance.commit;
  next.provenance.inputs[0].path = "files/en-us/web/other/index.md";
  assert.doesNotThrow(() => checkRecordCopy(seen, next, "other-doc.json"));
});

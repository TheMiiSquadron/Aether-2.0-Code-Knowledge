const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const YAML = require("yaml");

const projectRoot = path.resolve(__dirname, "../..");

const SAMPLE_PATHS = [
  "files/en-us/web/javascript/reference/global_objects/array/map/index.md",
  "files/en-us/web/api/fetch_api/index.md",
  "files/en-us/web/css/reference/properties/display/index.md",
  "files/en-us/web/html/reference/elements/a/index.md"
];

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the upstream repository: ${relativePath}`);
  }

  return resolved;
}

function splitFrontMatter(text) {
  const opening = text.match(/^\uFEFF?---\r?\n/);
  if (!opening) {
    throw new Error("MDN document does not start with YAML front matter");
  }

  const closing = /^---[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(text);
  if (!match) {
    throw new Error("MDN document has unterminated YAML front matter");
  }

  return {
    yaml: text.slice(opening[0].length, match.index),
    body: text.slice(match.index + match[0].length)
  };
}

function asArray(value) {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function mdnMetadata(frontMatter) {
  const data = {
    slug: frontMatter.slug,
    pageType: frontMatter["page-type"]
  };

  const optional = [
    ["short-title", "shortTitle", false],
    ["browser-compat", "browserCompat", true],
    ["sidebar", "sidebar", true],
    ["status", "status", true],
    ["spec-urls", "specUrls", true]
  ];

  for (const [sourceKey, targetKey, arrayValue] of optional) {
    if (frontMatter[sourceKey] !== undefined) {
      data[targetKey] = arrayValue
        ? asArray(frontMatter[sourceKey])
        : frontMatter[sourceKey];
    }
  }

  return { namespace: "mdn", schemaVersion: 1, data };
}

function createRecord({ upstreamRoot, relativePath, source, commit }) {
  const sourcePath = toPosix(relativePath);
  const absolutePath = resolveInside(upstreamRoot, sourcePath);
  const originalBytes = fs.readFileSync(absolutePath);
  const originalText = originalBytes.toString("utf8");
  const { yaml, body } = splitFrontMatter(originalText);
  const frontMatter = YAML.parse(yaml);

  if (!frontMatter || typeof frontMatter !== "object") {
    throw new Error(`Invalid MDN front matter in ${sourcePath}`);
  }
  for (const key of ["title", "slug", "page-type"]) {
    if (typeof frontMatter[key] !== "string" || frontMatter[key].length === 0) {
      throw new Error(`Missing MDN front matter field '${key}' in ${sourcePath}`);
    }
  }

  const policyFiles = source.licensing.policyPaths.map((policyPath) => {
    const policyBytes = fs.readFileSync(resolveInside(upstreamRoot, policyPath));
    return { path: toPosix(policyPath), sha256: sha256(policyBytes) };
  });

  return {
    $schema:
      "https://github.com/TheMiiSquadron/Aether-2.0-Code-Knowledge/schemas/processed-record.schema.json",
    schemaVersion: 1,
    id: `${source.id}:${frontMatter.slug}`,
    document: {
      title: frontMatter.title,
      language: "en-US",
      canonicalUrl: `https://developer.mozilla.org/en-US/docs/${frontMatter.slug}`
    },
    provenance: {
      sourceId: source.id,
      sourceType: source.sourceType,
      repository: source.repository,
      commit,
      inputs: [
        { path: sourcePath, role: "primary", sha256: sha256(originalBytes) },
        ...policyFiles.map((file) => ({ ...file, role: "license" }))
      ]
    },
    content: {
      original: {
        mediaType: "text/markdown",
        encoding: "utf-8",
        text: originalText,
        sha256: sha256(originalBytes)
      },
      normalized: {
        mediaType: "text/markdown",
        text: body,
        sha256: sha256(Buffer.from(body, "utf8")),
        transformations: [
          { id: "remove-yaml-front-matter", version: "1" }
        ]
      }
    },
    licensing: {
      policyFiles,
      rules: source.licensing.rules
    },
    sourceMetadata: mdnMetadata(frontMatter)
  };
}

function normalizeRepositoryUrl(url) {
  return url.replace(/^git\+/, "").replace(/\/$/, "");
}

function repositoryState(upstreamRoot, expectedRepository) {
  const git = (args) =>
    execFileSync("git", ["-C", upstreamRoot, ...args], { encoding: "utf8" }).trim();
  const commit = git(["rev-parse", "HEAD"]);
  const repository = git(["remote", "get-url", "origin"]);

  if (
    normalizeRepositoryUrl(repository) !==
    normalizeRepositoryUrl(expectedRepository)
  ) {
    throw new Error(
      `MDN origin '${repository}' does not match registry repository '${expectedRepository}'`
    );
  }

  return { commit };
}

function outputPathFor(outputRoot, relativePath) {
  const contentRelative = relativePath.replace(/^files\/en-us\//, "");
  return path.join(outputRoot, contentRelative.replace(/\/index\.md$/, "/record.json"));
}

function ingestSample({ upstreamRoot, outputRoot, registry }) {
  const source = registry.sources.find((entry) => entry.id === "mdn");
  if (!source || !source.enabled) throw new Error("Enabled MDN source not found");
  if (!source.adapter || source.adapter.id !== "mdn" || source.adapter.version !== 1) {
    throw new Error("MDN adapter v0.1 is not registered");
  }

  const resolvedUpstream = path.resolve(upstreamRoot);
  const resolvedOutput = path.resolve(outputRoot);
  const outputRelativeToUpstream = path.relative(resolvedUpstream, resolvedOutput);
  if (!outputRelativeToUpstream.startsWith("..") && !path.isAbsolute(outputRelativeToUpstream)) {
    throw new Error("Output directory must not be inside the upstream repository");
  }

  const { commit } = repositoryState(resolvedUpstream, source.repository);
  const records = SAMPLE_PATHS.map((relativePath) =>
    createRecord({ upstreamRoot: resolvedUpstream, relativePath, source, commit })
  );

  for (let index = 0; index < records.length; index += 1) {
    const destination = outputPathFor(resolvedOutput, SAMPLE_PATHS[index]);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(records[index], null, 2)}\n`, "utf8");
  }

  return records;
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (require.main === module) {
  const upstreamRoot = path.resolve(
    argumentValue("--upstream", path.resolve(projectRoot, "../Aether-Documentation/mdn"))
  );
  const outputRoot = path.resolve(
    argumentValue("--output", path.join(projectRoot, "processed/mdn-sample"))
  );
  const registry = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "sources.json"), "utf8")
  );
  const records = ingestSample({ upstreamRoot, outputRoot, registry });
  console.log(`Wrote ${records.length} MDN sample records to ${outputRoot}`);
}

module.exports = {
  SAMPLE_PATHS,
  createRecord,
  ingestSample,
  mdnMetadata,
  sha256,
  splitFrontMatter
};

# Aether-2.0-Code-Knowledge

Curated coding documentation and knowledge sources for Aether 2.0's models.

## MDN adapter v0.1

The initial adapter processes four representative MDN pages from a local
`mdn/content` clone. It preserves the exact source document, removes only YAML
front matter from the retrieval-oriented copy, and records the repository,
commit, source path, content hashes, and licensing policy.

```sh
npm run ingest:mdn:sample
npm run validate
npm test
```

The default clone location is `../../upstream/mdn` relative to this repository.
Use `--upstream <path>` or `--output <path>` to override the defaults.

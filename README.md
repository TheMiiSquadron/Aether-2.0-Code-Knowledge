# Aether 2.0 Knowledge

A curated, license-aware knowledge foundation for Selene, supporting the 12 Pillars of Aether 2.0.

## The 12 Pillars

| ID | Pillar |
|----| ---|
| 01 | Conversation |
| 02 | Coding |
| 03 | Computer Control |
| 04 | Memory & Knowledge |
| 05 | Research |
| 06 | Productivity |
| 07 | Creativity |
| 08 | Automation |
| 09 | Multimodal Understanding |
| 10 | Data Analysis |
| 11 | Artifact Creation |
| 12 | Integrations |

The `pillars/` directory provides the organizational structure for these capabilities.

## Knowledge Architecture

Aether uses a shared source registry rather than maintaining separate copies of documentation for each Pillar.

- `sources.json` — Registered documentation sources and their Pillar assignments.
- `schemas/` — JSON schemas for source and processed-record validation.
- `scripts/ingest/` — Documentation ingestion adapters.
- `scripts/validate/` — Registry and record validators.
- `processed/` — Normalized documentation records.
- `guidance/` — Knowledge guidance and policies.
- `pillars/` — Directories for the 12 Pillars.

The source registry currently uses schema version 3. Each source has a `pillars` array that can reference one or more Pillars.

## Current Knowledge Sources

| Source | Pillar | Status |
|---|---|---|
| MDN Web Docs | 02 — Coding | Sample ingestion implemented |
| Node.js API Documentation | 02 — Coding | Registered; adapter pending |
| Git Documentation | 02 — Coding | Registered; adapter pending |

Additional sources and Pillar assignments will be introduced incrementally.

## MDN Adapter v0.1

The initial MDN adapter processes four representative pages from a local `mdn/content` clone.

It preserves the original source content, removes YAML front matter from the normalized copy, and records source provenance, content hashes, and licensing information.

### Local Documentation

The default MDN clone location is:

`../Aether-Documentation/mdn`

This path is relative to the Aether knowledge repository.

The upstream repository can be overridden with `--upstream <path>`.

### Commands

```sh
npm run ingest:mdn:sample
npm run validate
npm test

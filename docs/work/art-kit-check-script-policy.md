---
id: art-kit-check-script-policy
title: Remove internal source fingerprint machinery from check scripts
status: done
approved: user decision, recorded by the owner (no dated reference)
design: packaging
related: [ak-0027]
---

## Scope

Remove repeated internal source fingerprint machinery from the stock check script paths.

## Criteria

- Source commit and archive identity, artifact checksums, guards, tool checks and failure
  propagation are preserved.
- External before and after dirty-file fingerprint verification remains the caller's step.

## Decisions

- Recorded in the approval ledger under this key; the same change is backfilled as ak-0027.

## Outcome

Landed on main in 16dc4af; first released in 0.23.0. Source-only change, no API change.

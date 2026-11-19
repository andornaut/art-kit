---
id: art-kit-variable-woff2-029-publication
title: Publish full variable TrueType WOFF2 encoding
status: done
approved: user, publication instruction
design: fonts
related: [ak-0036]
---

## Scope

Publish complete static and variable TrueType (glyf/loca) WOFF2 encoding through the existing
`encodeWoff2` API.

## Criteria

- `encodeWoff2(Uint8Array): Promise<Uint8Array>`, `wawoff2@2.0.1` and static outputs unchanged.
- Variation, metadata and licence tables preserved; exact source and immutable artifact verified.

## Decisions

- Recorded in the approval ledger under this key; the source work is ak-0036.

## Outcome

Landed in 48a721a, integrated on main at 233f7fd and released as 0.29.0.

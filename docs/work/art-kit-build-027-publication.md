---
id: art-kit-build-027-publication
title: Publish canonical build entry points with flat compatibility aliases
status: done
approved: user, all-kit build and test namespace change
design: build
related: [ak-0033, ak-0034, ak-0035]
---

## Scope

Publish the canonical build entry points, the deprecated flat compatibility aliases and the
caller-owned RGBA comparison in 0.27.0.

## Criteria

- Exact source checked and the immutable public artifact verified.
- Canonical entry points and compatibility aliases preserved; consumer adoption stays with the games.

## Decisions

- Recorded in the approval ledger under this key; the source work is ak-0033 and ak-0034. The
  aliases were later removed in ak-0035.

## Outcome

Landed in 063e5db and released as 0.27.0.

---
id: art-kit-test-pruning-target
title: Reduce executed test cases by at least 20 percent
status: done
approved: user, all kits, target 20 percent (undated)
design: packaging
related: [ak-0029]
---

## Scope

Reduce the executed test cases by at least 20 percent with justified coverage trade-offs, keeping
critical behaviour and public contracts.

## Criteria

- At least a 20 percent reduction in executed cases on a matching baseline; parameterization alone
  is not a reduction.
- Accepted low-risk coverage losses recorded; runtime and case counts reported separately.

## Decisions

- Recorded in the approval ledger under this key; the same work is backfilled as ak-0029. A later
  policy removed fixed case-count targets in favour of pruning for runtime.

## Outcome

Delivered in 51b9576 (12329 to 7228 executed cases, 41.4 percent); first released in 0.24.0.

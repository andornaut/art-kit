# Work items

Every user request is one file, `docs/work/<id>.md`, approved or not. It records scope and milestones; live progress
(claims, blocks, receipts and acceptance) stays in the work protocol state root. The [design
index](../design/README.md) lists the work items of each area.

| Front matter | Content                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `id`         | `ak-` and a zero-padded sequence (`ak-0001`), allocated in chronological order.                                         |
| `title`      | A short imperative title.                                                                                               |
| `status`     | `proposed` until the user approves, `approved`, `done`, `declined` when the user declines, `cancelled` or `superseded`. |
| `approved`   | A short approval or request reference, such as `user, 2026-11-18`.                                                      |
| `design`     | The design area in `docs/design/`.                                                                                      |
| `related`    | A list of related work IDs.                                                                                             |
| `supersedes` | The ID of the item this one replaces; omitted otherwise.                                                                |

The sections are Scope, Criteria, Decisions and Outcome. Decisions and Outcome state what was
decided or delivered, and why, in a line or two each.

- Only `main` edits design index tables and approved scope. Approval commits the work-file stub and
  its index row on `main`, and that commit allocates the ID.
- Workers edit only their own work file and the design prose that ships with their feature.
  Integration sets `status: done` in the commit that lands the item; a release tag containing that
  commit marks it deployed.
- A changed or reverted decision is a new work item with `supersedes`. A finished item's outcome is
  never rewritten.
- Work files are public: no session IDs, hostnames, local home-directory paths or quoted
  conversation, only short approval references.
- Backfilled items with no recorded approval are labelled `inferred`, when the release shows the
  approval, or `unrecorded`.
- Docs-only changes run only the attribution and lint checks ([ak-0041](ak-0041.md)).
- Design summaries and work files are not part of the release tarball.

# Evidence

## Release and runtime acceptance

AC1–AC5 PASS. The public engine contains no production profiles, target endpoints or credentials. Product-owned ESM adapters and exact component pins are committed in the four consumer repositories. The first Release Please version was v0.1.0; the working installer release is v0.1.1, exact source commit `4f76924e785baf6ab16d5813b120701f679b77cf`, archive SHA-256 `05555bedaeb722209ee4c0ac3fb18d0bf40f01665d6c647a51e5733f9a5a9998`. Release workflow 40093912140 published the verified archive, source manifest and checksum file.

Linux Quality passed all 25 core tests, including process locking and the installer umask regression. All nine real TLS wire tests passed. The four consumers passed nine focused profile checks. Forty-four comparisons against the previous engine confirmed real persisted-history compatibility, current/stale/future presentation and eight probe scenarios per consumer.

The supported installer applied the published v0.1.1 archive to all four running instances. Independent readback verified every installed release-file hash, repository/tag/commit and project-owned profile hash. Protected environment values and all static bundle bytes were preserved. Historical incident identities retained: CaseCore 50, MyRobotica 50, Alvori 34; Damkora had no historical incidents. Anonymous HTTPS page/feed requests with a browser user-agent returned 200, no-store JSON and current operational observations made after installation. No claim of a full login, financial or game scenario is made.

The failed v0.1.0 first activation and successful automatic rollback remain recorded in problems.md; no other consumer was changed by that failed attempt. Source formatting later required a Damkora profile-only reapply of the same component version; static files and history remained unchanged.

## Consumer source publication

AC6 PARTIAL. CaseCore PR 442, Alvori PR 728 and Damkora PR 37 are open; no consumer main merge is claimed. Their normal hooks and required documentation builds passed. Alvori documentation was built from its exact committed source in a detached verification-only checkout, preserving concurrent primary-checkout edits.

MyRobotica owns its profile and pin in local commit 7c85dd9f. Its shared checkout contains unrelated unfinished edits and unpublished commits. Its instructions forbid additional worktrees without explicit owner authorization and require a clean tree before ordinary push. Owner authorization for a temporary isolated publication worktree was requested and remains pending. No dirty-checkout push, hook bypass or publication of unrelated work was attempted.

Raw operator commands, configuration fingerprints, archive validation, before/after state snapshots, build logs and HTTPS readbacks remain protected outside public Git. Exact consumer receipts and source URLs are in evidence.json.

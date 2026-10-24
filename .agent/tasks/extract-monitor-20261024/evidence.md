# Evidence

## Release and runtime acceptance

AC1–AC5 PASS. The public engine contains no production profiles, target endpoints or credentials. Product-owned ESM adapters and exact component pins are committed in the four consumer repositories. The first Release Please version was v0.1.0; the working installer release is v0.1.1, exact source commit `4f76924e785baf6ab16d5813b120701f679b77cf`, archive SHA-256 `05555bedaeb722209ee4c0ac3fb18d0bf40f01665d6c647a51e5733f9a5a9998`. Release workflow 40093912140 published the verified archive, source manifest and checksum file.

Linux Quality passed all 25 core tests, including process locking and the installer umask regression. All nine real TLS wire tests passed. The four consumers passed nine focused profile checks. Forty-four comparisons against the previous engine confirmed real persisted-history compatibility, current/stale/future presentation and eight probe scenarios per consumer.

The supported installer applied the published v0.1.1 archive to all four running instances. Independent readback verified every installed release-file hash, repository/tag/commit and project-owned profile hash. Protected environment values and all static bundle bytes were preserved. Historical incident identities retained: CaseCore 50, MyRobotica 50, Alvori 34; Damkora had no historical incidents. Anonymous HTTPS page/feed requests with a browser user-agent returned 200, no-store JSON and current operational observations made after installation. No claim of a full login, financial or game scenario is made.

The failed v0.1.0 first activation and successful automatic rollback remain recorded in problems.md; no other consumer was changed by that failed attempt. Source formatting later required a Damkora profile-only reapply of the same component version; static files and history remained unchanged.

## Consumer source publication

AC6 PASS. CaseCore PR 442, Alvori PR 728 and Damkora PR 37 are open; no consumer main merge is claimed. Their normal hooks and required documentation builds passed. Alvori documentation was built from its exact committed source in a detached verification-only checkout, preserving concurrent primary-checkout edits.

The owner explicitly authorized temporary isolated worktrees. MyRobotica monitoring-only changes were transferred onto origin/main and published in PR 170, source commit `13ceeac694921ad5c9ef76be1a21d30c88734b77`. Normal staged and pre-push hooks passed; three profile checks passed on pinned Node 26.10.0. The installed profile matches the published bytes. Concurrent primary-checkout edits and unrelated unpublished commits were preserved. A prepare-created scheduler for the temporary checkout was removed immediately; the primary scheduler was preserved. Verification receipts are retained privately and the temporary checkout is cleaned up after publication.

This consumer currently has no standalone documentation build scripts/package. Repository Markdown metadata/link validation passed, but documentation compilation is not claimed. All four consumer PRs are open; no ordinary consumer main merge is claimed.

Raw operator commands, configuration fingerprints, archive validation, before/after state snapshots, build logs and HTTPS readbacks remain protected outside public Git. Exact consumer receipts and source URLs are in evidence.json.

Final live readback at 12:59 UTC on 2026-10-24 confirmed all four pages/feed pairs still returned 200/current/operational. The installed profile hashes are bound to exact committed consumer sources (including the formatted Damkora adapter). Runtime Node versions are 26.11.1 for three instances and 24.18.0 for Alvori; the older system Node on the shared host was not used or changed. Consumer hosted checks remained queued/pending when this source-delivery receipt was recorded; local successful gates were preserved.

After consumer source publication, a fresh independent HTTPS readback again returned page/feed 200 and current operational observations for all four domains. The final public receipt is recorded in evidence.json.

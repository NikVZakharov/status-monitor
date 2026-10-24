# Extract the reusable status monitor

Frozen 2026-10-24 before implementation. Owner: NikVZakharov. Repository: status-monitor (public).

## Scope

Extract the existing scheduler, bounded HTTP transport, persisted incident state and read-only status server. Load a trusted project-owned ESM profile; product names, component lists, target variables, health interpretation, maintenance contracts and branded summaries stay in the four product repositories. Existing static frontends, HTTPS routes, runtime ports and incident state remain in place. Internal infrastructure and credentials must not enter this repository.

## Acceptance criteria

- AC1: Public repository NikVZakharov/status-monitor contains a reusable implementation with no hardcoded production profiles, endpoints, credentials or internal deployment material. Each of the four consumers owns its adapter and an exact component release pin.
- AC2: Focused core, HTTP/TLS, state persistence, freshness and profile-contract checks pass. The public JSON and existing incident-state format remain compatible.
- AC3: Release Please runs on main, creates version metadata PRs and publishes a versioned archive plus SHA-256 checksums from the exact release commit. The first release is v0.1.0.
- AC4: All four existing runtime instances use the published component release and their own profile. Verify installed version, repository, source hashes and adapter hash. Preserve protected environment values, static bundles and historical incidents.
- AC5: Each of the four public status pages and feeds passes independent HTTPS readback with current observations and the expected product/component identity.
- AC6: Consumer deployment references point to the new component, with migration evidence and any unmerged consumer changes reported honestly. Preserve unrelated working-tree changes.

## Verification

Run the extracted focused core/TLS checks and project profile contract checks after implementation. Verify packaging checksums and manifest provenance. Apply the supported installer to each instance; independently compare protected config hashes (excluding the one added profile-path setting), bundle hashes and incident identities before/after, then verify service/source identity and public HTTPS behavior. Do not simulate a production outage or reset history to obtain green status.

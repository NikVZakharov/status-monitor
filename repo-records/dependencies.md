# Dependency selections

Verified 2026-10-24 from official upstreams:

- Node.js 26.12.1 (latest stable): https://nodejs.org/dist/index.json. Runtime also supports Node >=22.16; existing supported host runtimes are preserved.
- pnpm 12.15.0 (latest stable, Node >=18): https://registry.npmjs.org/pnpm/latest.
- actions/checkout v7.0.1: https://github.com/actions/checkout/releases/tag/v7.0.1.
- actions/setup-node v7.1.0: https://github.com/actions/setup-node/releases/tag/v7.1.0.
- pnpm/action-setup v6.1.0: https://github.com/pnpm/action-setup/releases/tag/v6.1.0.
- googleapis/release-please-action v5.0.0: https://github.com/googleapis/release-please-action/releases/tag/v5.0.0.

Actions are pinned to their tag's exact commit SHA. There are no third-party runtime dependencies. Python 3 and OpenSSL are build/test tools only; Linux installation requires Node, Bash, flock and systemd.

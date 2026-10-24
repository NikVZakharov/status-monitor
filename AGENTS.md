# Status Monitor

- Keep the engine independent of product names, endpoints and health contracts. Trusted ESM profiles belong to consumer repositories; examples and test fixtures are synthetic.
- Preserve the public JSON contract and persisted incident-state format. Never reset history or fabricate observations to make a service green.
- Keep credentials and private deployment material out of Git and release archives.
- Use pnpm for package commands. Run focused core/TLS and packaging checks after changes.
- Release Please owns VERSION, CHANGELOG.md and its manifest after bootstrap. Build release artifacts from the exact release commit.
- Keep all task records under .agent/tasks/<id>; keep sensitive raw deployment evidence ignored.

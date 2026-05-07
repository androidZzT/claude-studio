# Source template for a Codex-backed harness repository.
# Edit this file directly. Then run `harness sync` to render local adapter projections.
# Generated AGENTS.md and .codex/config.toml are ignored by git; commit the templates instead.

name: {{name}}
scope: {{scope}}

tools:
  - codex

canonical:
  instructions: ./AGENTS.md.template
  codexConfig: ./.codex/config.toml.template

adapters:
  codex:
    enabled: true
    target: .

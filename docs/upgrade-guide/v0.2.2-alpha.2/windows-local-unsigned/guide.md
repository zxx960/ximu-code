---
kind: upgrade-guide
description: "Local unsigned Windows packaging omits update services and ignores release configuration."
---

# Local unsigned Windows packaging

English | [中文](guide.zh.md)

## Change

`pnpm run package:desktop:win:x64:unsigned` builds a local installer without automatic or mandatory updates. It ignores machine presets, `.env.windows`, and inherited release settings, uses application ID `com.deepseek.harness`, and requires no signing certificate or policy service. Signed and preparation-only builds retain their release configuration requirements.

## Migration

Use the unsigned command for local installation testing. If the previous unsigned installer used a custom application ID, test this installer separately before replacing it. For a build that requires update services, use the signed Windows packaging command with the configured deployment and certificate. Run the unsigned command with `--check` to validate local tooling.

---
kind: upgrade-guide
description: "Desktop displays 西牧code and the supplied logo while retaining existing account and Session storage."
---

# Desktop product identity

English | [中文](guide.zh.md)

## Change

The Desktop application, native menus, installer labels, sidebar, and conversation welcome artwork use **西牧code** and the supplied logo. Native executables are named `ximu-code.exe` on Windows and `ximu-code` inside `西牧code.app` on macOS. The `dsh` command and `dsh` URL scheme retain their names. Browser deployments keep their existing branding.

## Migration

Use the updated application shortcuts and bundled `dsh` launcher. Recreate manually pinned shortcuts or scripts that directly reference the previous executable name. Existing installation identifiers and the legacy `DeepSeek Harness` userData directory are retained; explicit `--user-data-dir` overrides continue to work. No account, credential, or Session data is moved.

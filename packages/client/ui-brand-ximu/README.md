---
kind: package-reference
description: "Desktop-owned product name and artwork in client brand slots."
---

# @deepseek-ai/dsh-client-ui-brand-ximu

English | [中文](README.zh.md)

## Summary

The Desktop profile shows the native shell's product name and supplied logo in the sidebar and blank-conversation hero. Browser profiles keep their existing branding.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

The web-app bundle mounts this plugin only for the Desktop profile. The primary renderer receives a public `dshDesktop.brand` identity from preload; other documents register no occupants. Slot registration waits for each declaring surface and withdraws with its plugin lifetime. Components receive the identity as plain injected props.

The native shell owns the name and logo URL. The same supplied artwork is shown at the size requested by each surface, without modifying its content. The official branding plugin is disabled for the Desktop profile.

## Model Experience

### Brand presentation

#### What the model sees

Nothing; `dshDesktop.brand` stays in client presentation and is never added to model requests or Session events.

#### Token effect

Zero direct tokens.

#### KV Cache effect

None; the plugin does not assemble provider requests.

## Known Limitations and Deferred Work

- The native shell must supply the public identity before client plugins load. This plugin does not select arbitrary remote artwork or configure Web branding.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

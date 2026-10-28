---
description: "Ximu email/password authentication and account recharge balances for the Desktop profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-account-ximu

English | [中文](README.zh.md)

## Summary

The Desktop profile signs in with email and password through the Ximu management API. The Host stores the access token in the credential provider at `account-ximu/default`; passwords are never persisted. Account settings show the email and recharge balance without a currency symbol because the API supplies no currency.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The base bundle mounts this provider only for the Desktop profile. `baseURL` defaults to `https://codex.ximuai.com/api/v1`; `requestTimeoutMs` defaults to 30000 and `maxResponseBytes` to 65536. HTTPS is required except for explicitly enabled loopback HTTP test fixtures.

`signInWithPassword` submits `POST auth/login`; `getProfile` and `getBalance` share an overlapping `GET auth/me` request authenticated with `Authorization: Bearer`. Both direct responses and successful `{ code: 0, data }` envelopes are accepted. Only email, numeric balance, and safe status codes reach ordinary account UI consumers.

HTTP 401 on login reports invalid credentials. HTTP 401 on `auth/me` removes the local login and publishes session expiry; other query failures retain the login and display a retryable failure. Sign-out removes the local token and retains independently configured model API keys. Cancellation prevents pending login responses from committing; an admitted credential write finishes before sign-out returns.

<a id="model-experience"></a>
## Model Experience

### Account authentication

#### What the model sees

Nothing. Account credentials and balances remain Host and account UI data. The management token is never returned by `resolveToken` or `getPlatformSession`.

#### Token effect

Zero direct tokens on every model request.

#### KV Cache effect

Account operations do not change model request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The management API documents neither token refresh nor remote logout. Group keys, inference routes, model discovery, and online top-up pages are not provided by this plugin. A login therefore does not configure a model provider. The API supplies no stable account ID or balance currency.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

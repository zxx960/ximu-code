---
description: "Ximu email/password authentication and account recharge balances for the Desktop profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-account-ximu

English | [中文](README.zh.md)

## Summary

The Desktop profile signs in with email and password through the Ximu management API. The Host stores the access token in the credential provider at `account-ximu/default`; passwords are never persisted. Account settings show the email and recharge balance with a USD suffix. The account’s top-up link points to `/purchase` on the configured API origin.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The base bundle mounts this provider only for the Desktop profile. `baseURL` defaults to `https://codex.ximuai.com/api/v1`; `requestTimeoutMs` defaults to 30000 and `maxResponseBytes` to 65536. HTTPS is required except for explicitly enabled loopback HTTP test fixtures.

`signInWithPassword` submits `POST auth/login`; `getProfile` and `getBalance` share an overlapping `GET auth/me` request authenticated with `Authorization: Bearer`. Both direct responses and successful `{ code: 0, data }` envelopes are accepted. Profile and balance results contain no credentials.

`getGroups` reads `GET groups/available` using the stored management token and returns validated group IDs, names, and platform names. The result is null when signed out or when credentials change during the request; a failed query returns a retryable failure without discarding the login. Empty lists are successful results.

`getGroupKeys(groupId)` reads `/keys?page=1&page_size=100&group_id=…` and follows every page within one `requestTimeoutMs` deadline. `maxKeyPages` defaults to 100; an incomplete, inconsistent, or oversized listing fails without returning partial keys. Only active keys for the requested group with remaining quota and no elapsed expiry are returned; omitted group IDs inherit the requested group. The explicit result contains inference secrets for the provider-creation draft, never the management token. Queries do not create keys or persist them.

`createGroupKey(groupId)` submits one authenticated `POST keys` with the selected group and `keyName` (default `西牧ai`) after an explicit UI action. Overlapping calls for the same account generation and group share one submission. A successful result returns only the created key ID; callers refresh the list separately. Definite HTTP client refusals return `failed`, while network loss, server errors, invalid success replies, disposal, or account changes after submission return `unknown`. Unknown outcomes require a list refresh before another creation; the provider never retries a POST automatically.

HTTP 401 on login reports invalid credentials. HTTP 401 on an authenticated account query removes the local login and publishes session expiry; other query failures retain the login and display a retryable failure. Sign-out removes the local token and retains independently configured model API keys. Cancellation prevents pending login responses from committing; an admitted credential write finishes before sign-out returns.

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

- The management API documents neither token refresh nor remote logout. This plugin does not configure inference routes, model discovery, or online top-up pages. Login alone does not configure a model provider. The API supplies no stable account ID or balance currency.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

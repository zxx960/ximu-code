---
kind: upgrade-guide
description: "Desktop uses Ximu email/password accounts and no longer offers DeepSeek account authorization or a bonus balance row."
---

# Desktop account login

English | [中文](guide.zh.md)

## Change

The Desktop profile uses the Ximu management API for email/password login and recharge balances. Existing DeepSeek account grants remain stored but do not sign into the Desktop Ximu account. The account settings page omits bonus balances. Desktop Welcome requires account sign-in and offers no API-key or skip action; a model key does not bypass sign-out or account expiry. Desktop onboarding no longer reads model-key presence through preload. Other profiles retain browser authorization.

## Migration

Desktop custom model APIs use a group selector in place of a manual display name. Choose a group from the signed-in account before creating a provider; its name becomes the provider display name. Existing providers keep their saved names. Group selection does not provision model keys or change the API protocol.

After choosing a group, select one of its usable API keys instead of typing a key. Switching groups clears the selection. The selected secret is used for model discovery and stored only when the provider is saved; queries do not create server-side keys.

If the group has no usable keys, click **Create key** beside **Retry** to create one and refresh the list. This is an explicit server-side change; reopening or refreshing the form does not create keys.

1. Sign in through the Desktop email/password form. Passwords are not saved.
2. For a private deployment, set `baseURL` under the `ximu-account` row in `$DSH_HOME/profiles/desktop/cordis.patch.yml` to its HTTPS management API root.
3. Open Settings → Account and confirm the email and recharge balance. Independently configured model API keys remain usable; this login does not provision model keys or inference routes.

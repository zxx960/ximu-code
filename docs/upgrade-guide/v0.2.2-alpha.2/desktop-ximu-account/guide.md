---
kind: upgrade-guide
description: "Desktop uses Ximu email/password accounts and no longer offers DeepSeek account authorization or a bonus balance row."
---

# Desktop account login

English | [中文](guide.zh.md)

## Change

The Desktop profile uses the Ximu management API for email/password login and recharge balances. Existing DeepSeek account grants remain stored but do not sign into the Desktop Ximu account. The account settings page omits bonus balances. Desktop Welcome requires account sign-in and offers no API-key or skip action; a model key does not bypass sign-out or account expiry. Desktop onboarding no longer reads model-key presence through preload. Other profiles retain browser authorization.

## Migration

1. Sign in through the Desktop email/password form. Passwords are not saved.
2. For a private deployment, set `baseURL` under the `ximu-account` row in `$DSH_HOME/profiles/desktop/cordis.patch.yml` to its HTTPS management API root.
3. Open Settings → Account and confirm the email and recharge balance. Independently configured model API keys remain usable; this login does not provision model keys or inference routes.

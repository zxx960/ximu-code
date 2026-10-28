---
kind: upgrade-guide
description: "桌面端使用西牧邮箱密码账号，不再提供 DeepSeek 账号授权或赠金余额行。"
---

# 桌面账号登录

[English](guide.md) | 中文

## 变更

桌面配置使用西牧管理接口提供邮箱密码登录和充值余额。已有 DeepSeek 账号凭据仍然保留，但不能用于桌面西牧账号登录。账号设置页不显示赠金余额。其他配置保留浏览器授权。

## 迁移

1. 在桌面邮箱密码表单中登录，不会保存密码。
2. 私有部署在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 的 `ximu-account` 条目下设置 `baseURL`，指向 HTTPS 管理接口根地址。
3. 打开设置 → 账号与余额，确认邮箱和充值余额。独立配置的模型 API Key 仍可使用；本次登录不创建模型密钥或推理路由。

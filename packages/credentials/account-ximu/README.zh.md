---
description: "为桌面配置提供西牧邮箱密码登录和账号充值余额。"
kind: "package-reference"
---

# @deepseek-ai/dsh-account-ximu

[English](README.md) | 中文

## 概述

桌面配置通过西牧管理接口使用邮箱和密码登录。Host 将访问令牌保存到凭据提供方的 `account-ximu/default`，从不持久化密码。账号设置显示邮箱和充值余额；接口未提供币种，因此不显示货币符号。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

基础组合包仅在桌面配置中挂载此提供方。`baseURL` 默认为 `https://codex.ximuai.com/api/v1`，`requestTimeoutMs` 默认为 30000，`maxResponseBytes` 默认为 65536。必须使用 HTTPS；显式启用的本地回环 HTTP 测试服务除外。

`signInWithPassword` 提交 `POST auth/login`；`getProfile` 和 `getBalance` 共享重叠执行的 `GET auth/me` 请求，使用 `Authorization: Bearer` 鉴权。支持直接返回和成功的 `{ code: 0, data }` 包装格式。普通账号界面使用方仅接收邮箱、数值余额和安全状态码。

登录返回 HTTP 401 时报告凭据错误。`auth/me` 返回 HTTP 401 时移除本地登录并通知会话失效；其他查询失败保留登录态，显示可重试的错误。退出登录移除本地令牌，保留独立配置的模型 API Key。取消操作阻止未完成的登录响应提交凭据；已接纳的凭据写入会在退出返回前完成。

<a id="model-experience"></a>
## 模型体验

### 账号认证

#### 模型看到什么

无。账号凭据和余额仅用于 Host 和账号界面。`resolveToken` 和 `getPlatformSession` 从不返回管理令牌。

#### Token 影响

每次模型请求均不直接增加 Token。

#### KV 缓存影响

账号操作不改变模型请求前缀。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 管理接口未定义令牌刷新或服务端退出。此插件不提供分组密钥、推理路由、模型发现或在线充值页面，因此登录不会配置模型提供方。接口未提供稳定的账号 ID 或余额币种。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

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

`signInWithPassword` 提交 `POST auth/login`；`getProfile` 和 `getBalance` 共享重叠执行的 `GET auth/me` 请求，使用 `Authorization: Bearer` 鉴权。支持直接返回和成功的 `{ code: 0, data }` 包装格式。账号资料和余额结果不包含凭据。

`getGroups` 使用已保存的管理令牌读取 `GET groups/available`，返回校验后的分组 ID、名称和平台名称。未登录或请求期间凭据发生变化时返回 null；查询失败返回可重试的失败状态，保留登录态。空列表属于成功结果。

`getGroupKeys(groupId)` 读取 `/keys?page=1&page_size=100&group_id=…`，在一次 `requestTimeoutMs` 截止时间内读取所有分页。`maxKeyPages` 默认为 100；列表不完整、不一致或超过限制时失败，不返回部分密钥。仅返回所选分组内已启用、额度未耗尽且未到期的密钥；省略分组 ID 时按请求分组处理。显式返回值包含提供商创建草稿所用的推理密钥，不包含管理令牌。查询不会创建或保存密钥。

`createGroupKey(groupId)` 在显式界面操作后提交一次已认证的 `POST keys`，携带所选分组和 `keyName`（默认 `西牧ai`）。同一账号代次和分组的重叠调用共享一次提交。成功结果只返回已创建密钥的 ID，调用方另行刷新列表。明确的 HTTP 客户端拒绝返回 `failed`；提交后发生网络中断、服务端错误、成功响应无效、销毁或账号变化时返回 `unknown`。结果未知时必须先刷新列表，再决定是否再次创建；提供方不会自动重试 POST。

登录返回 HTTP 401 时报告凭据错误。已认证的账号查询返回 HTTP 401 时移除本地登录并通知会话失效；其他查询失败保留登录态，显示可重试的错误。退出登录移除本地令牌，保留独立配置的模型 API Key。取消操作阻止未完成的登录响应提交凭据；已接纳的凭据写入会在退出返回前完成。

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

- 管理接口未定义令牌刷新或服务端退出。此插件不配置推理路由、模型发现或在线充值页面。仅登录不会配置模型提供方。接口未提供稳定的账号 ID 或余额币种。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

---
kind: upgrade-guide
description: "Windows 本地未签名打包省略更新服务并忽略发布配置。"
---

# Windows 本地未签名打包

[English](guide.md) | 中文

## 变更

`pnpm run package:desktop:win:x64:unsigned` 构建不含自动更新和强制更新的本地安装包。该命令忽略机器 preset、`.env.windows` 和继承的发布配置，使用应用 ID `com.deepseek.harness`，无需签名证书或策略服务。签名及仅准备构建保留其发布配置要求。

## 迁移

本地安装测试使用未签名命令。如果之前的未签名安装包使用自定义应用 ID，替换前应单独测试此安装包。需要更新服务时，使用带部署与证书配置的 Windows 签名打包命令。为未签名命令添加 `--check` 可校验本机工具链。

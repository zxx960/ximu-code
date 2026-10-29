---
kind: upgrade-guide
description: "桌面端显示西牧code及所提供的图标，同时保留现有账号和 Session 存储。"
---

# 桌面软件标识

[English](guide.md) | 中文

## 变更

桌面应用、原生菜单、安装器标签、侧栏与会话欢迎图使用 **西牧code** 及所提供的 logo。Windows 原生可执行文件名为 `ximu-code.exe`，macOS 为 `西牧code.app` 内的 `西牧code`。`dsh` 命令与 `dsh` URL scheme 名称保持不变。浏览器部署保留原有品牌。

## 迁移

使用更新后的应用快捷方式及随包的 `dsh` 启动器。手动固定的快捷方式或脚本若直接引用旧的可执行文件名，请重新创建。现有安装标识及旧的 `DeepSeek Harness` userData 目录保留，显式 `--user-data-dir` 覆盖仍然有效。不移动账号、凭据或 Session 数据。

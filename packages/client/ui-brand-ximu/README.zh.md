---
kind: package-reference
description: "在客户端品牌槽位显示由桌面端管理的软件名称和图标。"
---

# @deepseek-ai/dsh-client-ui-brand-ximu

[English](README.md) | 中文

## 概述

桌面配置在侧栏和空会话欢迎区显示原生壳提供的软件名称及所提供的图标。浏览器配置保留原有品牌。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

web-app bundle 仅在桌面配置中挂载此插件。主渲染器通过 preload 接收公开的 `dshDesktop.brand` 标识；其他文档不注册占位内容。槽位注册等待各展示位置的声明，并随插件生命周期撤销。组件通过普通注入属性接收标识。

原生壳管理名称和图标 URL。各展示位置按所需尺寸使用同一张图，不修改图片内容。桌面配置禁用官方品牌插件。

<a id="model-experience"></a>
## 模型体验

### 品牌呈现

#### 模型看到什么

无；`dshDesktop.brand` 仅用于客户端呈现，不会加入模型请求或 Session 事件。

#### Token 影响

直接 token 数为零。

#### KV Cache 影响

无；本插件不组装提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 原生壳必须在客户端插件加载前提供公开标识。此插件不选择任意远程图片，也不配置 Web 品牌。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

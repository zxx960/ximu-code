# 发布西牧code 安装包与下载页

[English](publishing-ximu-code.md) | 中文

## 摘要

将 Windows x64 和 Mac Apple Silicon 安装包发布到现有 Cloudflare R2 桶，然后更新 <https://ximu-code.ximuai.com/> 的下载页。两个安装包使用同一源码提交，更新公开链接前先验证上传后的文件字节。仅修改页面文案时，从第 4 步开始并保留现有下载链接。

## 目录

- [发布步骤](#publishing-steps)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)

<a id="publishing-steps"></a>
## 发布步骤

准备 Node >=24.9、仓库指定的 pnpm 版本、已认证的 Cloudflare 访问权限，以及所需版本和架构的安装包。本流程发布关闭自动更新与强制更新的未签名测试包，不调用签名桌面版的更新发布器。

1. **收集安装包。** 核对版本、架构和源码提交。Windows x64 使用 `pnpm run package:desktop:win:x64:unsigned` 构建。在同一提交上运行 [Mac 工作流](../../.github/workflows/macos-arm64-unsigned.yml)，等待成功后下载安装包产物和 `SHA256SUMS.txt`。本地产物目录为 `apps/desktop/.desktop-build/targets/{win-x64,mac-arm64}/unsigned-artifacts/`。
2. **上传 R2。** 使用账户 `302809262cd0132cd9f3a9a40653c762`、桶 `wangpan`，前缀为 `ximu-code/<version>/<source-commit-short-hash>/`。公开对象命名为 `ximu-code-<version>-windows-x64-unsigned.exe` 和 `ximu-code-<version>-mac-arm64-unsigned.dmg`，按这些公开文件名生成 `SHA256SUMS.txt`。大文件使用 S3 分片上传，设置正确的 MIME、附件文件名和 `Cache-Control: public, max-age=31536000, immutable`。新构建使用新路径，保留现有对象。凭据只存于已认证的本机存储或进程环境变量，不写入源码、文档或日志。
3. **验证下载。** 上传前计算本地 SHA256。完整读取上传后的每个对象，比较字节数与 SHA256，并确认 `https://wangpan.ximuai.com/<object-path>` 可公开访问。任一校验失败，停止修改官网链接。
4. **修改页面。** 更新根目录的唯一源文件 `ximu-code.html`：下载链接、版本、架构和实际文件大小。下载按钮副文案只保留架构和大小，省略“未签名本地测试包”和“未公证测试包”。仅修改文案时保留现有链接，跳过安装包上传。
5. **准备部署。** 复用仅托管静态资源的 Worker `ximu-code` 和自定义域名 `ximu-code.ximuai.com`。本机暂存目录 `.playwright-mcp/cf-site/` 受 Git 忽略；将源 HTML 复制到该目录的 `public/index.html`，使用其中本地安装的 Wrangler。若暂存目录不存在，创建私有包并安装 Wrangler，再配置账户、Worker、自定义域名和 `assets.directory: ./public`。读取当前远端设置，保留兼容日期、可观测性和域名设置。暂存目录可重建，受版本管理的 HTML 和本指南保留发布说明。
6. **部署。** 认证 Cloudflare 后进入暂存目录，先运行 `pnpm exec wrangler deploy --dry-run`，检查结果，再运行 `pnpm exec wrangler deploy`。本机 Cloudflare CLI 的认证存储为 `%APPDATA%/xdg.config/cloudflare/config/default.json`；认证过期时通过已安装的 CLI 刷新，并通过进程环境向 Wrangler 提供有效凭据。记录 Worker 部署版本 ID。若部署失败，停止依赖该部署的后续操作，检查线上实际状态后再报告结果。
7. **线上验收与交付。** 请求线上首页，检查文案、版本和两个下载链接。检查安装包响应的大小和附件文件名，然后运行 `git diff --check`。验证成功后交付官网地址、安装包链接、校验信息和部署版本 ID。源码提交与线上部署分别记录。

<a id="further-exploration"></a>
## 进一步探索

修改 Windows 打包或签名前，阅读 [Windows 签名指南](../../apps/desktop/windows-signing/README.zh.md)。[Mac 工作流](../../.github/workflows/macos-arm64-unsigned.yml)负责执行器配置、打包及产物保留。

<a id="dev-note"></a>
## 开发备注

无。

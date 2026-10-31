# Publish 西牧code installers and download page

English | [中文](publishing-ximu-code.zh.md)

## Summary

Publish Windows x64 and Mac Apple Silicon installers to the existing Cloudflare R2 bucket, then update the download page at <https://ximu-code.ximuai.com/>. Use installers from the same source commit and verify uploaded bytes before changing public links. For page-copy changes, start at step 4 and keep existing download URLs.

## Table of Contents

- [Publishing steps](#publishing-steps)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

<a id="publishing-steps"></a>
## Publishing steps

Use Node >=24.9, the repository's pnpm version, authenticated Cloudflare access, and installers for the requested version and architectures. This workflow publishes unsigned test installers with automatic and mandatory updates disabled; it does not invoke the signed desktop update publisher.

1. **Collect installers.** Confirm that the version, architecture, and source commit match. Build Windows x64 with `pnpm run package:desktop:win:x64:unsigned`. Run the [Mac workflow](../../.github/workflows/macos-arm64-unsigned.yml) on the same commit, wait for success, then download its installer artifact and `SHA256SUMS.txt`. Local artifact directories are `apps/desktop/.desktop-build/targets/{win-x64,mac-arm64}/unsigned-artifacts/`.
2. **Upload to R2.** Use account `302809262cd0132cd9f3a9a40653c762`, bucket `wangpan`, and prefix `ximu-code/<version>/<source-commit-short-hash>/`. Name public objects `ximu-code-<version>-windows-x64-unsigned.exe` and `ximu-code-<version>-mac-arm64-unsigned.dmg`; generate `SHA256SUMS.txt` using these public names. Use S3 multipart upload for large files, correct MIME types, attachment filenames, and `Cache-Control: public, max-age=31536000, immutable`. Give each new build a new path; retain existing objects. Keep credentials in authenticated local storage or process environment variables; never put them in source, documentation, or logs.
3. **Verify downloads.** Compute local SHA256 digests before upload. Read each complete uploaded object and compare its byte count and SHA256. Confirm public access at `https://wangpan.ximuai.com/<object-path>`. Stop before changing website links if any verification fails.
4. **Edit the page.** Update the canonical root `ximu-code.html`: download URLs, version, architecture, and actual file sizes. Download-button subtitles contain architecture and size only; omit “未签名本地测试包” and “未公证测试包”. For copy-only changes, retain existing URLs and skip installer uploads.
5. **Prepare deployment.** Reuse the assets-only Worker `ximu-code` and custom domain `ximu-code.ximuai.com`. The local, Git-ignored staging directory is `.playwright-mcp/cf-site/`; copy the canonical HTML to `public/index.html` there and use its locally installed Wrangler. If staging is absent, recreate it with a private package and Wrangler, then configure the account, Worker, custom domain, and `assets.directory: ./public`. Read current remote settings and preserve the compatibility date, observability, and domain settings. The ignored directory is disposable; the tracked HTML and this guide retain the publishing instructions.
6. **Deploy.** Authenticate with Cloudflare, enter the staging directory, run `pnpm exec wrangler deploy --dry-run`, inspect the result, then run `pnpm exec wrangler deploy`. This machine's Cloudflare CLI authentication store is `%APPDATA%/xdg.config/cloudflare/config/default.json`; refresh expired authentication through the installed CLI and supply valid credentials to Wrangler through its process environment. Record the Worker deployment version ID. If deployment fails, stop dependent actions and inspect the actual production state before reporting the outcome.
7. **Verify production and deliver.** Request the live homepage and check copy, version, and both download URLs. Check installer response sizes and attachment filenames, then run `git diff --check`. Report the website, installer links, checksum information, and deployment version ID after verification succeeds. Record source commits and production deployments separately.

<a id="further-exploration"></a>
## Further Exploration

Read the [Windows signing guide](../../apps/desktop/windows-signing/README.md) before Windows packaging or signing changes. The [Mac workflow](../../.github/workflows/macos-arm64-unsigned.yml) owns runner setup, packaging, and artifact retention.

<a id="dev-note"></a>
## Dev Note

None.

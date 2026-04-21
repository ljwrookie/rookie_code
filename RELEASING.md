# 自动发布指南

每次向 `main` 分支 `git push` 时，GitHub Actions 会自动完成以下操作：

1. 安装依赖并执行 lint + build
2. 自动 bump CLI 的 patch 版本并发布到 npm
3. 自动 bump VS Code 扩展的 patch 版本并发布到 Open VSX
4. 将版本号变更提交回 `main` 分支

## 需要配置的 Secrets

在 GitHub 仓库 Settings > Secrets and variables > Actions 中添加：

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `NPM_TOKEN` | npm 发布 Token | `npm login` 后在 npm 网站生成 Access Token |
| `OVSX_TOKEN` | Open VSX 发布 Token | 在 [open-vsx.org](https://open-vsx.org/) 注册并生成 Token |

## 手动触发发布

如果需要在非 main 分支发布，可以手动触发：

```bash
# CLI
pnpm --filter rookie-code build
cd packages/cli
npm version patch
npm publish --access public

# VS Code 扩展（Open VSX）
pnpm --filter rookie-code-vscode build
cd packages/vscode-extension
npm version patch
npx ovsx publish -p YOUR_OVSX_TOKEN
```

## 版本策略

当前 CI 使用 `npm version patch` 自动递增 patch 版本号。如果需要发布 minor 或 major 版本：

1. 在本地手动修改 `packages/cli/package.json` 和 `packages/vscode-extension/package.json` 的版本号
2. 提交并 push 到 main
3. CI 会使用你指定的版本号发布

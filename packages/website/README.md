# Rookie Code Website

项目官网 / 展示页（Vite + React + Tailwind），位于 `packages/website`。

## 本地开发

在仓库根目录执行：

```bash
pnpm --filter website dev
```

## 构建与预览

```bash
pnpm --filter website build
pnpm --filter website preview
```

## 部署（GitHub Pages）

push 到 `main` 且变更包含 `packages/website/**` 时，会触发 GitHub Pages 自动部署：

- workflow: `.github/workflows/deploy-website.yml`

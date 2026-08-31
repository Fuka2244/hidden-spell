# Cloudflare 自部署与维护

本项目不提供公共联机服务器。部署者需要自己的 Cloudflare 账号，托管前端静态资源、Worker 和 SQLite-backed Durable Objects。文档不包含维护者的线上地址、账号或自定义域名。

## 首次部署

在项目根目录执行：

```sh
npm ci
npx wrangler login
npm test
npm run typecheck
npm run build
npm run deploy --workspace @hidden-spell/worker
```

发布前检查 `apps/worker/wrangler.jsonc` 的 `name`，设为你希望创建或更新的 Worker 名称。多账号用户可明确填写自己的 `account_id`，不要写入 API Token。名称与已有 Worker 相同时可能更新该 Worker，需先确认目标。

授权后，Wrangler 会部署 Worker、SQLite-backed Durable Object 和前端，并输出 HTTPS 地址。使用该地址创建房间，通过游戏码邀请朋友。只上传 HTML、CSS 和图片到静态托管不够，联机还依赖 Worker 和 Durable Objects。

## 自定义域名

可使用平台分配的默认地址，也可以在自己的 Cloudflare 账号中绑定自己管理的域名。确认 DNS 和证书正常后再邀请玩家使用；不要将其他部署者的账号、域名或凭证复制进配置。

## 更新与回滚

修改代码或 `apps/web/public/content/` 素材后重新测试、构建和发布。房间状态保存在 Durable Object，前端发布不会主动删除它。

回滚可通过 Cloudflare 控制台的 Worker 版本页面操作。不要删除 Durable Object 命名空间，否则可能丢失现有房间。更换域名不会自动迁移浏览器内的席位凭证，避免在进行中的对局中途切换地址。

## 本地验证

```sh
npm test
npm run typecheck
npm run build
npm run dev --workspace @hidden-spell/worker
```

`npm run build` 中的 Worker 构建是 dry-run，不会发布。本地服务通常位于 `http://localhost:8787`，仅用于本机测试；不同玩家请使用独立浏览器环境。

## 凭证与用量

通过 Wrangler 官方登录流程授权，不要在仓库保存 Token 或真实席位凭证。`.wrangler/`、`.wrangler-config/`、`.env*`、`.dev.vars*`、日志和本地数据库应保持忽略。

费用和可用额度取决于部署者账号。当前前端自动重连尚无总次数上限，应在公开推广前补充限制并监控请求与存储用量。Git 推送不会自动发布，本仓库未配置自动部署工作流。

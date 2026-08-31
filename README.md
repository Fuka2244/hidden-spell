# 出包魔法师 · Hidden Spell

基于 Vue 3、TypeScript 与 Cloudflare Workers 的隐藏手牌桌游，支持 2–4 人房间联机、八种咒语效果、回合与轮次计分、服务器裁决及原身份重连。

**本仓库不提供公共联机服务器。与朋友跨设备联机，需要使用自己的 Cloudflare 账号部署前端、Worker 和 Durable Objects。**

## 功能

- 创建房间、通过 6 位游戏码加入、角色选择、准备与房主开局。
- 个性化牌局视图：自己的隐藏手牌不向自己发送牌面，玩家只能收到有权查看的信息。
- 八种咒语效果由服务器裁决，支持施法、结束回合、轮次结算及胜利判定。
- 断线暂停、90 秒原身份重连、主动退出认输与房主转移。
- 可替换内容包，包含图板、角色、牌背和咒语图片配置。

## 本地运行

建议使用 Node.js 22.19 或以上。首次安装依赖后构建前端，再启动本地联机服务：

```sh
npm ci
npm run build --workspace @hidden-spell/web
npm run dev --workspace @hidden-spell/worker
```

打开终端显示的本地地址，通常为 `http://localhost:8787`。多玩家测试请使用不同浏览器或独立浏览器配置，避免共享同一席位。不要将 localhost 房间地址发给其他设备；它只指向各自的本机。

## 自行部署联机

1. 准备自己的 Cloudflare 账号，并在 `apps/worker/wrangler.jsonc` 中设置你使用的 Worker 名称。
2. 通过正常浏览器授权登录，完成检查后发布：

```sh
npx wrangler login
npm test
npm run typecheck
npm run build
npm run deploy --workspace @hidden-spell/worker
```

3. 使用发布命令输出的 HTTPS 地址进入游戏，创建房间并把地址和游戏码分享给朋友。

配置中不包含维护者账号或自定义域名。`npm run build` 的 Worker 构建为 dry-run，不会发布；只有 deploy 命令进行正式发布。仅部署静态前端无法提供完整联机能力。Git 推送不等于 Cloudflare 发布，本仓库未配置自动部署工作流。

## 目录

- `apps/web/`：Vue 前端、牌桌界面和内容包。
- `apps/worker/`：Cloudflare Worker、房间服务和 Durable Objects。
- `packages/game-core/`：规则引擎与测试。
- `packages/protocol/`：客户端与服务器通信协议及校验。
- `docs/`：规则说明、架构决策、素材配置和自部署文档。

## 注意事项

- 席位凭证保存在当前浏览器；清除站点数据或更换域名不会自动迁移身份。
- 当前客户端自动重连尚未设置总次数上限。面向大量玩家开放前，建议补充重试上限、入口限流和用量监控，避免异常网络下持续消耗服务额度。
- 不要提交 Cloudflare Token、真实玩家凭证、私钥、本地数据库或调试日志。
- 本仓库包含当前游戏使用的内容包；如需分享或替换素材，请自行确认可使用范围。

详细说明：[自行部署](docs/DEPLOYMENT.md)、[内容包](docs/CONTENT_PACK.md)、[规则来源](docs/RULES_SOURCE_NOTES.md)、[架构决策](docs/adr/0001-authoritative-game-server.md)。

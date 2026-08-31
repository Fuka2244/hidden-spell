# 使用 Cloudflare Workers 托管首版游戏

首版使用 Cloudflare Workers 静态资源、原生 WebSocket 和 SQLite-backed Durable Objects，并通过免费的 `workers.dev` 地址发布。该选择牺牲中国大陆网络质量的确定性，换取无需购买域名、办理 ICP 备案或维护常驻服务器；此前的阿里云中国内地 ECS 和 Node.js 常驻进程方案不再采用。

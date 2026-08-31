# 私有内容包

游戏启动时会尝试读取 `/content/manifest.json`。文件不存在、格式错误或部分字段缺失时，页面自动使用内置通用名称与图形，不影响规则和联机。

## 使用方法

1. 复制 `apps/web/public/content/manifest.example.json` 为同目录下的 `manifest.json`。
2. 把 Logo、图板、牌背、四个角色和八张牌的图片放入 `apps/web/public/content/`。
3. 在 `manifest.json` 中填写名称、说明和以 `/content/` 开头的图片地址。
4. 重新构建并部署。

支持相对站点根目录的地址和 `https://` 地址。`cardBackImageUrl` 同时用于自己的隐藏手牌和中央秘密牌。角色固定使用 `red`、`blue`、`green`、`purple` 四个槽位；咒语固定使用 `1` 至 `8`。内容包只改变显示，不参与服务端规则裁决。

当前已接入用户提供的图板照片，以及从用户提供 PDF 原始内嵌图像中提取的八张牌、牌背和四个角色。正式内容清单位于 `apps/web/public/content/manifest.json`。

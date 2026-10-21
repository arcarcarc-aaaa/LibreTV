# LibreTV 2.19.7：从 Pages 改用 Workers

本配置基于 `arcarcarc-aaaa/LibreTV` 的 `9d86ec2568895b2a8b52da47fc9bfea6c74f8378`，保留 LibreTV 2.19.7 的应用功能。原 Pages 将未构建源码作为静态文件上传，不能运行这份 Next.js 应用。

## 1. 在 Cloudflare 创建新的 Worker

打开 **Workers 和 Pages → 创建应用 → 从 GitHub 导入存储库**，选择创建 **Worker**，连接 `arcarcarc-aaaa/LibreTV`。代码使用适配分支 `codex/cloudflare-workers`，无需先合并到 main。

| 项目 | 填写内容 |
|---|---|
| Worker 名称 | `libretv-workers` |
| Git 仓库 | `arcarcarc-aaaa/LibreTV` |
| 生产分支 | `codex/cloudflare-workers` |
| 根目录 | 仓库根目录，保持默认 |
| 构建命令 | `npm run build:cloudflare` |
| 部署命令 | `npm run deploy:cloudflare` |
| 构建变量 | `NODE_VERSION` = `24.19.0` |

依赖由 Cloudflare 根据 package.json 和 package-lock.json 安装。如果界面单独提供依赖安装命令，填写 `npm ci`。提交的锁文件固定依赖版本，不需要手工修改。

Worker 名称必须与 wrangler.jsonc 中的 name、WORKER_SELF_REFERENCE 的 service 一致。如果需要改名，请同时修改三处。

这里没有 Pages 的“构建输出目录”；不要把 `.next` 填成静态文件目录。代码已指定 Worker 入口 `.open-next/worker.js` 和资源目录 `.open-next/assets`。

## 2. 设置运行时密码

第一次部署完成后，进入新 Worker 的 **设置 → 变量和机密（Variables & Secrets）**：

| 名称 | 类型 | 值 |
|---|---|---|
| `PASSWORD` | Secret / 机密 | 自己设置的访问密码 |
| `COOKIE_SECURE` | Text / 文本 | `true` |

保存并部署此配置。PASSWORD 必须是 Worker 的运行时机密；仅放在“构建变量”里不会让运行中的网站读到密码。原 Pages 的变量不会自动迁移。

密码只在 Cloudflare 控制台输入，不要写进 GitHub 文件或发到聊天里。若原项目还有自己配置的预置数据等变量，按需迁移到新 Worker 的运行时设置。

## 3. 先验证新 Worker

打开 Cloudflare 实际分配的 `https://libretv-workers.<你的账户子域名>.workers.dev/`，账户子域名以控制台显示为准。

依次检查：

1. 首页显示 LibreTV。
2. `/api/status` 返回 JSON，`version` 为 `2.19.7`、`passwordRequired` 为 `true`。
3. 使用你设置的密码登录，登录后 `/api/status` 的 `verified` 为 `true`。

如果默认域名受当前网络限制，也可先绑定一个临时测试域名。不要用“部署成功”替代访问验证。

本改动不添加任何媒体数据源。首页与登录通过，不能证明你自己的数据源或播放链路已通过；这些还需要用你已有的可用地址验证。

## 4. 验证后接回 tv.yumishaomai.dpdns.org

原 Pages 项目保留，先记录原域名绑定和 `tv` DNS 记录，便于恢复。

1. 在原 Pages 项目的 **自定义域** 中移除 `tv.yumishaomai.dpdns.org` 的绑定。
2. 查看 `yumishaomai.dpdns.org` 的 DNS。如果仍有 `tv` 指向 `libretv-a52.pages.dev` 的 CNAME，只删除这一条旧记录。
3. 进入新 Worker → **设置 → 域和路由（Domains & Routes）→ 添加 → 自定义域**，填写 `tv.yumishaomai.dpdns.org`。
4. 等 Cloudflare 显示域名和证书就绪，再打开首页和 `/api/status` 验证。

Workers Custom Domain 不能与同名的现有 CNAME 并存。域名必须属于你账户中处于 Active 状态的 Cloudflare zone。让 Worker 的“自定义域”入口管理记录，不要手工 CNAME 到 workers.dev。

若需要恢复：移除 Worker 上的该自定义域，然后在旧 Pages 中重新添加原域名并恢复记录。旧 Pages 的应用部署问题仍需另行处理。

## 技术变更与验证边界

- LibreTV 应用版本仍是 2.19.7；底层 Next.js 升至 16.4.2。当前 OpenNext 构建器拒绝已超出其支持期的 Next.js 15，因此没有使用跳过检查的选项。
- 固定 `@opennextjs/cloudflare` 1.20.12 和 Wrangler 4.151.3，使用 webpack 构建。
- 增加 Worker 入口、静态资源、Node 兼容及自身服务绑定；没有配置付费存储资源。
- 登录限流改成请求时清理，移除模块顶层定时器。现有内存限流按实例生效，并非跨所有 Worker 实例的全局限流。
- 将 Workers 不支持的 dns.lookup 换成 A/AAAA 查询，保留私有地址拒绝；无法验证或三秒内未响应时拒绝目标。
- 本地 Workers 预览中首页、状态接口、错误密码拒绝、正确密码登录、会话验证、退出和静态资源已通过。
- 当前环境下真实外网 DNS/上游请求验证未通过，不能据此声称搜索和播放已验证；部署后需要在 Cloudflare 实际网络中验证。
- 本地安装使用 npm 12，其默认阻止依赖安装脚本；测试、构建及本地 Workers 运行已实际完成，未通过忽略构建错误来绕过检查。云端仍需查看真实构建日志。
- 尚未创建云端 Worker、修改 DNS 或切换线上域名，线上可用性未验证。

## 本地或 CI 命令

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --dry-run
npm run preview:cloudflare
```

本地预览密码放在不入库的 `.dev.vars`。准备好云端配置后，`npm run deploy:cloudflare` 才会实际部署。

参考：[Cloudflare OpenNext](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)、[Workers 构建设置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[Workers 自定义域](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[Workers DNS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/)。

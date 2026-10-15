# News Alert

**版本：3.1**

这是个**科技新闻与合规资讯聚合、AI 摘要与推送**的项目，特征是**通过本地 Node 服务连接内置 MCP 趋势引擎抓取多源资讯，用 OpenAI 兼容接口生成「新闻 Top10 / 合规 Top10」及 Bambu Lab 社区舆情总结，并通过 SMTP 发送邮件；飞书 Webhook 仅用于推送合规侧内容（见下文），不推送新闻 Top10**。

---

## 运行前置条件

以下为基于本仓库代码与配置的真实依赖（按类别归纳）。

1. **运行环境与内置引擎**
  - 已安装 **Node.js**（建议 LTS）。  
  - 项目通过子进程启动 `dist/index.cjs`（mcp-trends-hub 预编译入口），**无需单独安装 MCP 包**；新闻源列表来自该进程暴露的 MCP Tools。
2. **网络与信息源可达性**
  - 抓取新闻、合规 RSS/网页、以及部分 **Headless（Puppeteer）** 站点需要可访问对应外网 URL。  
  - 可选：若使用 trends-hub 的自定义 RSS，需设置环境变量 `TRENDS_HUB_CUSTOM_RSS_URL`（逗号分隔 URL，见 `dist` 内逻辑）。
3. **AI 接口（摘要 / Top10 / 社区舆情等）**
  - 在 `app/data/config.json`（或通过控制面板）配置 **OpenAI 兼容** 的 `baseUrl`、`modelName`、`apiKey`；请求路径为 `{baseUrl}/v1/chat/completions`（见 `app/services/summarizer.js`）。  
  - **新闻 AI Top10**、**合规 Top10**、**Bambu Lab 社区舆情总结**（见下节）、新闻条目摘要等均依赖该配置；未配置完整时会报错提示在设置中填写。
4. **推送与可选凭证**
  - **SMTP**：发件邮箱、授权码、`smtpHost`、`smtpPort`（默认示例为 163，`app/data/config.example.json`）。  
  - **收件人组**：`recipientGroups`，用于新闻 / 合规分别选组发信（`app/services/email.js` 中邮件正文为新闻 Top10 或新闻列表、以及合规 Top10 或合规列表，**不含**社区舆情独立段落）。  
  - **飞书 Webhook**（`app/services/webhook.js` → `sendComplianceDigestWebhook`）：`webhook.enabled` 且配置有效 URL 时，**仅**向飞书发送 **「合规 AI 总结」**：消息体包含 **Bambu Lab 社区舆情** 一节（结论与最多 5 条发现，来自当前内存中的社区舆情对象；无有效内容时显示「暂无社区舆情总结」）以及 **合规 Top10 条目（标题 + 原文链接，最多 10 条）**。**不包含** MCP 新闻 Top10、也不作为「全站新闻摘要」通道。支持 `open.feishu.cn` 机器人 Webhook 与 `feishu.cn/flow` 触发器 URL。  
  - **Headless 合规源**：`DataGuidance` 等需在配置中提供 `headlessCredentials`（如 `dataguidance` 的邮箱与密码），并可使用 `app/data/cookies/` 下 cookie 文件；**IAPP** 等为无登录 Headless，依赖本机 Puppeteer/Chromium 环境。

---

## 项目内建新闻源（MCP）

以下工具名来自 `News_Alert/dist/index.cjs` 中注册的 MCP Tool（与 `/api/sources` 列表一致）。各源可在界面中单独启停、条数与「最近 N 天」在配置中覆盖。


| MCP 工具名                     | 说明（与 dist 内 description 一致或缩写） |
| --------------------------- | ------------------------------ |
| `get_36kr_trending`         | 36 氪热榜                         |
| `get_9to5mac_news`          | 9to5Mac                        |
| `get_bbc_news`              | BBC 新闻                         |
| `get_bilibili_rank`         | 哔哩哔哩排行                         |
| `get_douban_rank`           | 豆瓣排行                           |
| `get_douyin_trending`       | 抖音热榜                           |
| `get_gcores_new`            | 机核最新                           |
| `get_ifanr_news`            | 爱范儿                            |
| `get_infoq_news`            | InfoQ                          |
| `get_juejin_article_rank`   | 掘金文章榜                          |
| `get_netease_news_trending` | 网易新闻热点                         |
| `get_nytimes_news`          | 纽约时报                           |
| `get_smzdm_rank`            | 什么值得买排行                        |
| `get_sspai_rank`            | 少数派排行                          |
| `get_tencent_news_trending` | 腾讯新闻热点                         |
| `get_thepaper_trending`     | 澎湃热榜                           |
| `get_theverge_news`         | The Verge                      |
| `get_toutiao_trending`      | 今日头条热榜                         |
| `get_weibo_trending`        | 微博热搜                           |
| `get_weread_rank`           | 微信读书排行                         |
| `get_zhihu_trending`        | 知乎热榜                           |


---

## 项目内建合规源

默认定义在 `app/services/compliance-sources.js` 的 `DEFAULT_COMPLIANCE_SOURCES`（可与 `config.json` 的 `complianceSources` 合并覆盖）。下表为各源的展示名称（`name` 字段）：

- European Commission News  
- BEUC Position Papers  
- Ireland DPC Latest News（Scrape）  
- Ireland DPC Press Releases（Scrape）  
- EDPB News Feed  
- Ecommerce Europe News  
- Bundeskartellamt Updates  
- Autorite de la concurrence  
- AGCM Media e Comunicazione  
- Garante Privacy Comunicati  
- Garante Privacy Newsletter  
- CCPC Business News  
- SOMI News  
- IAPP News（Headless）  
- DataGuidance News（Headless，需登录凭证）  
- Google News: EU AI Act Legislation/Enforcement  
- Google News: EU Data Act Legislation/Enforcement  
- Google News: Chinese Tech under US/EU Regulatory Actions  
- Google News: Data Transfer EU/US Legislation/Enforcement  
- Google News: Privacy Legislation/Enforcement (General)  
- Google News: Bambu Lab Privacy/Data Concerns  
- Reddit: Bambu Lab Privacy/Security Discussions  
- Forum: Bambu Lab Privacy/Security Discussions  
- Facebook/News: Bambu Lab Privacy/Security

部分源配置了 RSS/抓取失败时的 **Google News RSS 等 fallback**，以同文件内 `fallback` 为准。

---

## Bambu Lab 社区舆情总结（用户可见能力）

与代码 `app/services/summarizer.js` 中 `summarizeComplianceCommunityPulse` 及界面「**Bambu Lab 社区舆情总结（隐私/安全）**」一致：

- **输入数据**：在**当前合规抓取结果**中筛选——`_source` 含 `forum_bambulab`、`facebook_bambulab`、`reddit_bambulab`、`google_search_bambulab`（历史键名），或标题/摘要/描述/链接中英文组合同时命中 `bambu` 与 `privacy` / `security`。  
- **无匹配帖子时**：不调用模型，直接返回 `hasDiscussion: false`、`findings: []`，结论文案为「近期未发现针对 Bambu Lab 隐私或安全的社区讨论。」（与前端默认展示一致）。  
- **有匹配时**：去重后最多取 **120** 条，调用同一套 AI 配置；模型须返回单一 JSON 对象（含 `hasDiscussion`、`conclusionZh` / `conclusionEn`、`findings` 等，见代码内 Prompt）。解析后 `**findings` 最多保留 5 条**，且条目须带非空 `link`；`hasDiscussion` 在代码中与「存在有效 findings」对齐。  
- **出现位置**：执行「AI 分析」流式任务时（`server.js` 中与合规 Top10 同批）、控制面板独立区块展示、**TXT 导出**中含对应段落（`server.js` 导出逻辑）、**飞书 Webhook** 正文中的「Bambu Lab 社区舆情」块（见上一节）。**SMTP 邮件**当前不渲染该总结（`sendEmail` 未接收社区舆情对象）。

---

## AI 新闻 Top10 默认 Prompt

逻辑位于 `app/services/summarizer.js` 的 `digestTop10`。模型收到的文本由**固定模板**与**动态部分**拼接而成：

- 动态：`${cappedItems.length}` 为去重后参与分析的新闻条数上限（最多取前 500 条中的实际条数）；`新闻列表：` 以下为编号的标题行（含来源标签与可选链接）。  
- 固定模板原文如下（与代码一致；字段名中的数字随 `cappedItems.length` 变化）：

```
你是资深双语科技新闻编辑。以下是今日 ${cappedItems.length} 条热点新闻标题（来自多个平台）。

任务：找出最重要、跨平台出现频率最高的 10 个热点话题，按热度排序。

输出要求：直接返回 JSON 数组，每个元素：
{"rank":1,"titleZh":"中文标题","titleEn":"English Title","summaryZh":"2句话中文核心摘要","summaryEn":"1-2 sentence English summary","sources":"来源1,来源2","refIndex":该话题最具代表性的一条新闻的序号,"url":"该条新闻的原始链接"}

强制规则：
1. titleZh 和 summaryZh 必须是自然中文，不能保留纯英文
2. titleEn 和 summaryEn 必须是自然英文
3. 不要把中英文混在同一个字段里
4. 即使原标题是英文，也必须补充准确中文；即使原标题是中文，也必须补充对应英文
5. refIndex 必须是新闻列表中的序号（1 到 ${cappedItems.length}），选择该话题最具代表性的一条
6. url 必须从新闻列表中原样复制，不要编造链接；如果该条新闻没有链接则留空字符串

不要返回markdown标记、不要多余解释，只返回JSON数组。

新闻列表：
${titleList}
```

（`${titleList}` 在代码中由 `1. [source] 标题 | 链接` 形式逐行拼接。）

---

## 快速开始


| 系统          | 操作                                     |
| ----------- | -------------------------------------- |
| **Windows** | 双击当前目录下的 `start.bat`                   |
| **macOS**   | 双击当前目录下的 `start.command`（首次可能需右键 → 打开） |


依赖安装在 `app` 目录下执行；启动后控制面板默认 **[http://localhost:3201](http://localhost:3201)**（端口见 `app/server.js` 中 `PORT`）。

在 **设置** 中配置 AI、邮箱、Webhook、收件人组、新闻源与合规源、定时任务等。

### 开机自启动（可选）

在 `app` 目录：

```bash
npm run autostart
```

---

## 技术架构（摘要）


| 层    | 技术                                            |
| ---- | --------------------------------------------- |
| 后端   | Node.js + Express（`app/server.js`）            |
| 新闻聚合 | MCP 子进程 `dist/index.cjs`                      |
| 合规抓取 | RSS / 静态抓取 / Puppeteer（`headless-scraper.js`） |
| AI   | OpenAI 兼容 Chat Completions（`summarizer.js`）   |
| 邮件   | Nodemailer + SMTP                             |
| 飞书   | 仅合规摘要 + 社区舆情（`webhook.js`）                    |
| 定时   | node-cron（`scheduler.js`）                     |


---

## API 摘录


| Method       | Endpoint                      | 说明                                |
| ------------ | ----------------------------- | --------------------------------- |
| `GET`        | `/api/sources`                | MCP 新闻源列表                         |
| `GET`        | `/api/compliance-sources`     | 合规源列表                             |
| `POST`       | `/api/fetch`                  | 抓取新闻与合规                           |
| `GET`        | `/api/digest/stream?type=all` | SSE 流式 AI 分析                      |
| `POST`       | `/api/send-email`             | 发送邮件                              |
| `POST`       | `/api/send-webhook`           | 发送飞书 Webhook（合规 Top10 + 社区舆情，见上文） |
| `POST`       | `/api/webhook/test`           | Webhook 连通性测试                     |
| `GET`/`POST` | `/api/config`                 | 读写配置                              |


完整列表见历史文档或 `server.js` 路由注册。

---

## 致谢与许可

- [mcp-trends-hub](https://github.com/baranwang/mcp-trends-hub) — MCP 新闻聚合引擎  
- 许可见仓库 `LICENSE`


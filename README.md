# WorldFirst Radar

访问地址（待 GitHub Pages 开启）：https://templehao.github.io/Worldfirst/radar/

本仓库在 `radar/` 子目录下提供独立的九家跨境支付公司舆情观察站。当前初始数据为已核对原始报道的历史样本，不代表每天实时抓取已经成功。

## 目录
- `radar/index.html`：响应式网站（可搜索、按公司/类别/信源筛选）
- `radar/data/articles.json`：静态 JSON 数据接口
- `radar/data/latest.md`：AI 可读摘要
- `radar/data/feed.xml`：RSS
- `radar/data/status.json`：最近轮询状态与采集成功统计

## 发布
仓库 Settings → Pages → Build and deployment → Deploy from a branch → main / (root)，将自动把 radar 作为子路径访问。GitHub Pages **不是实时抓取服务器**，静态网页需要由单独的数据采集程序持续生成数据文件。当前尚未验收自动采集或大陆稳定访问。

数据中 `source_type` 代表来源性质（官方、独立媒体、企业通稿、搜索线索），`status=verified` 仅表示有可核实的公开原文，不代表对全部事实独立审计。新闻条数也不代表全网声量。

下一阶段可以添加定时采集适配器，接入合法授权的社交平台数据供应方并配置告警；不会把模拟数据伪装为实时数据。

## FX 全球外汇情报中心（Demo）

- 页面（GitHub Pages 启用后）：https://templehao.github.io/Worldfirst/Fx/
- 路径：Fx/，与现有 radar/ 并列，互不覆盖
- 每小时抓取 RSS 元数据：.github/workflows/fx-refresh.yml
- 使用说明与证据机制：Fx/docs/RELIABILITY.md
- ChatGPT 订阅分析须由独立的实际模型任务执行并提交，不能把确定性规则归类标为 AI 已分析。
- 初始页面展示明确标记的演示条目，第一次抓取成功后才显示真实新闻。

### Fx 官方行情参考与更新（v0.3）
- 官网：https://templehao.github.io/Worldfirst/Fx/
- 新闻窗口：7×24小时，RSS 约20分钟检查一次，不保证准实时推送。
- 数据：Fx/data/market.json，欧洲央行/香港金管局官方每日参考值，非可成交实时报价；绝不补造缺失数值。
- 来源与时间：每一条可追溯到官网及源观察日期，衍生交叉汇率显式说明计算口径。
- 展示：顶部六个汇率参考观察位，相关文章出现同日口径的参考值；页面每3分钟检查已经发布的最新快照。
- 可验证：python -m unittest discover -s Fx/scripts -p 'test_*.py' -v

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

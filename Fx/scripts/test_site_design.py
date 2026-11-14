"""Content-first information-flow regression tests."""
import unittest
from html.parser import HTMLParser
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.ids=[];self.links=[];self.tags=[]
    def handle_starttag(self,tag,attrs):
        data=dict(attrs);self.tags.append((tag,data))
        if data.get("id"):self.ids.append(data["id"])
        if tag=="a" and data.get("href","").startswith("#"):self.links.append(data["href"][1:])

class SiteDesignTests(unittest.TestCase):
    def setUp(self):
        self.html=(ROOT/"index.html").read_text(encoding="utf-8")
        self.css=(ROOT/"style.css").read_text(encoding="utf-8")
        self.js=(ROOT/"app.js").read_text(encoding="utf-8")
        self.page=Page();self.page.feed(self.html)
    def test_single_canonical_news_flow(self):
        self.assertEqual(len(self.page.ids),len(set(self.page.ids)))
        for key in ("market-grid","market-chart","detail-chart","market-warning",
                    "latest-news","stream","article-count","source-list","source-health",
                    "search","refresh-data","load-more","chart-select","chart-value"):
            self.assertIn(key,self.page.ids)
        for removed in ("hero-title","short-news","analysis-preview","watch-list",
                        "calendar","focus","research","news-rail","analysis"):
            self.assertNotIn(removed,self.page.ids)
        self.assertEqual(self.page.ids.count("stream"),1)
        for target in self.page.links:
            self.assertIn(target,self.page.ids)
    def test_sans_serif_and_responsive(self):
        self.assertIn('"PingFang SC"',self.css)
        self.assertIn("font-weight:350",self.css)
        self.assertIn("--bg:#090d13",self.css)
        self.assertIn("@media(max-width:580px)",self.css)
        self.assertNotIn("Songti",self.css)
        self.assertNotIn("STSong",self.css)
        self.assertNotIn("font-family:serif",self.css)
        self.assertNotIn("Worldfirst",self.html)
    def test_no_fabricated_data_or_front_page_placeholders(self):
        for number in ("7.2356","106.84"):
            self.assertNotIn(number,self.html)
        for source in ('json("articles.json")','json("editorial.json")',
                       'json("market.json")'):
            self.assertIn(source,self.js)
        self.assertIn("change_5_published_days_pct",self.js)
        self.assertIn("function sevenDays",self.js)
        self.assertIn("function rateFor",self.js)
        self.assertIn('source_url',self.js)
        self.assertIn("raw.githubusercontent.com/TempleHao/Worldfirst",self.js)
        self.assertIn('origin:"page"',self.js)
        self.assertIn("更新延迟",self.js)
        workflow=(ROOT.parent/".github/workflows/fx-refresh.yml").read_text(encoding="utf-8")
        self.assertIn("gh workflow run radar-pages.yml",workflow)
        self.assertIn("actions: write",workflow)
    def test_r14_accessible_ticker_with_offshore_cnh_boundary(self):
        for key in ("market-viewport","ticker-toggle","ticker-prev","ticker-next"):
            self.assertIn(key,self.page.ids)
        self.assertEqual(sum(tag=="option" for tag,attrs in self.page.tags),14)
        self.assertIn('value="USD/CNH"',self.html)
        self.assertIn('value="USD/CNY"',self.html)
        self.assertIn("Rates By Exchange Rate API",self.html)
        self.assertIn("const R14=",self.js)
        self.assertIn("parseCNHOpen",self.js)
        self.assertIn("parseCNHCommunity",self.js)
        self.assertIn("refreshCNH()",self.js)
        self.assertIn("initTicker()",self.js)
        self.assertIn("prefers-reduced-motion",self.js)
        self.assertIn('ticker-run ticker-clone',self.js)
        self.assertIn('aria-hidden="true"',self.js)
        self.assertIn("market-viewport",self.css)
        self.assertIn("ticker-controls",self.css)
        self.assertNotIn('USD/CNH", "CNY"',self.js)
    def test_freshness_vs_collection_status_and_schedule_fallback(self):
        self.assertIn("latest_article_published_at",self.js)
        self.assertIn("new_article_count",self.js)
        self.assertIn("最新原文发布",self.js)
        self.assertIn("本轮新收录",self.js)
        self.assertIn("检查已发布数据",self.html)
        self.assertIn("不会立即从所有 RSS 源抓取",self.html)
        from pathlib import Path
        wf=(ROOT.parent/".github/workflows/fx-refresh.yml").read_text(encoding="utf-8")
        self.assertIn('workflows: ["Refresh Radar Search Feeds"]',wf)
        self.assertIn("workflow_run:",wf)
        self.assertIn("github.event.workflow_run.conclusion == 'success'",wf)
    def test_bold_ticker_and_verifiable_market_data(self):
        self.assertIn("font-size:23px;font-weight:750",self.css)
        self.assertIn("font:750 25px/1.13 var(--mono)",self.css)
        self.assertIn("font:700 12.5px/1.2 var(--mono)",self.css)
        self.assertIn("font:400 10px/1.3 var(--font)",self.css)
        self.assertIn("tile-change-label",self.js)
        self.assertIn("validRSSArticle",self.js)
        self.assertIn("validOfficialRate",self.js)
        self.assertIn("newsAttempted",self.js)
        self.assertIn("integrityIssues",self.js)
        self.assertIn("非事实核验",self.js)
    def test_real_vector_logo_and_attribution(self):
        import xml.etree.ElementTree as ET
        brand=(ROOT/"assets"/"fx-intel-mark.svg")
        self.assertTrue(brand.is_file(), "SVG brand asset is missing")
        root=ET.parse(brand).getroot()
        self.assertTrue(root.tag.endswith("svg"))
        self.assertIn('class="brand-symbol"',self.html)
        self.assertIn('class="brand-english"',self.html)
        self.assertIn('class="brand-signal"',self.html)
        self.assertIn('rel="icon" type="image/svg+xml"',self.html)
        self.assertIn("FX INTEL",self.html)
        self.assertIn("Rates By Exchange Rate API",self.html)
        self.assertIn("third_party_daily_indicative",self.js)
        self.assertIn("CNH_FREE_URL",self.js)
        self.assertNotIn("rateFor(\"USD/CNY\")",self.js)
    def test_no_redundant_research_calendar_or_fake_news(self):
        for heading in ("最新资讯","本周重点观察","重要经济日历","本周关注"):
            self.assertNotIn(heading,self.html)
        self.assertNotIn('id="hero"',self.html)
        self.assertNotIn('id="analysis"',self.html)
        self.assertNotIn("市场解读</h2>",self.html)
        self.assertIn("数据缺失或过期时直接标明",self.html)

if __name__=="__main__":unittest.main()

"""Cold financial dashboard: visual system, data provenance and navigation contracts."""
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class Ids(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=[]; self.internal=[]
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        if "id" in d:self.ids.append(d["id"])
        if tag=="a" and d.get("href","").startswith("#"):
            self.internal.append(d["href"][1:])

class SiteDesignTests(unittest.TestCase):
    def test_navigation_and_data_ids(self):
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        p=Ids();p.feed(html)
        self.assertEqual(len(p.ids),len(set(p.ids)),"duplicate HTML IDs")
        for name in ["hero-title","hero-dek","hero-source","market-grid","chart-select",
                     "detail-chart","latest-news","analysis-preview","short-news",
                     "watch-list","calendar","stream","search","refresh-data","market-warning"]:
            self.assertIn(name,p.ids)
        for target in p.internal:
            if target.startswith("story-"):continue
            self.assertIn(target,p.ids)
    def test_sans_serif_cold_design(self):
        css=(ROOT/"style.css").read_text(encoding="utf-8")
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        self.assertIn('"PingFang SC"',css)
        self.assertIn("font-weight:350",css)
        self.assertIn("--page:#f5f7fa",css)
        self.assertIn("@media(max-width:570px)",css)
        self.assertNotIn("Songti",css)
        self.assertNotIn("STSong",css)
        self.assertNotIn("font-family:serif",css)
        self.assertNotIn("Worldfirst",html)
        self.assertNotIn("Worldfirst",css)
    def test_no_fabricated_market_numbers_or_events(self):
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        js=(ROOT/"app.js").read_text(encoding="utf-8")
        for example in ["7.2356","106.84","USD/CNH"]:
            self.assertNotIn(example,html)
        self.assertIn('getJSON("./data/articles.json")',js)
        self.assertIn('getJSON("./data/market.json")',js)
        self.assertIn("change_5_published_days_pct",js)
        self.assertIn("sourceMarket",js)
        self.assertIn("recent(a)",js)
        self.assertNotIn("Worldfirst",js)
    def test_real_official_calendar_links(self):
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        for domain in ["federalreserve.gov","ecb.europa.eu","boj.or.jp"]:
            self.assertIn(domain,html)
        self.assertIn("尚未接入可核实的具体事件时间",html)

if __name__=="__main__":
    unittest.main()

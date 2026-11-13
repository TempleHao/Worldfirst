import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import collect

class FakeResponse:
    def __init__(self, body): self.stream=io.BytesIO(body)
    def __enter__(self): return self
    def __exit__(self, *args): self.stream.close()
    def read(self, n): return self.stream.read(n)

RSS=b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Fed interest rate decision</title><link>https://example.com/a?utm_source=foo&amp;x=1</link>
<pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate><description>Do not save this</description></item>
<item><title>Fed interest rate decision</title><link>https://example.com/a?utm_source=bar&amp;x=1</link>
<pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""

# Regression fixtures represent valid FX-relevant articles within the seven-day window.
class CollectorTests(unittest.TestCase):
    def test_rss_metadata_only(self):
        items=collect.parse_feed(RSS)
        self.assertEqual(len(items),2)
        self.assertNotIn("description",items[0])
        self.assertEqual(items[0]["url"],"https://example.com/a?x=1")
        self.assertEqual(items[0]["published_at"],"2026-11-13T10:00:00Z")
    def test_dedup(self):
        source={"name":"官方测试","url":"https://example.com/rss","kind":"official"}
        a=[collect.make_article(x,source) for x in collect.parse_feed(RSS)]
        self.assertEqual(len(collect.dedup(a)),1)
    def test_atom(self):
        atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Euro monetary policy</title><link href="https://example.com/b"/><updated>2026-11-13T10:00:00Z</updated></entry></feed>'
        self.assertEqual(len(collect.parse_feed(atom)),1)
    def test_invalid_links(self):
        self.assertIsNone(collect.url_clean("javascript:alert(1)"))
        self.assertIsNone(collect.url_clean("data:text/html,aaa"))
    def test_unknown_publication_date(self):
        self.assertIsNone(collect.stamp("not a date"))
    def test_official_is_not_ai(self):
        source={"name":"央行","url":"https://example.com/rss","kind":"official"}
        obj=collect.make_article(collect.parse_feed(RSS)[0],source)
        self.assertEqual(obj["analysis_mode"],"rule_index")
        self.assertEqual(obj["verification"],"official")
        self.assertFalse("可信度百分比" in str(obj))
    def test_off_topic_official_article_excluded(self):
        source={"name":"央行","url":"https://example.com/rss","kind":"official"}
        item={"title":"Future of Artificial Intelligence and Democracy","url":"https://example.com/ai","published_at":"2026-11-13T12:00:00Z"}
        self.assertIsNone(collect.make_article(item,source))
    def test_bis_editorial_relevance_gate(self):
        official={"name":"国际清算银行·央行讲话","url":"https://www.bis.org/rss","kind":"official"}
        item={"title":"Opening remarks at Financial Services Gala","url":"https://example.com/unrelated","published_at":"2026-11-13T10:00:00Z"}
        self.assertIsNone(collect.make_article(item,official))
        item["title"]="Monetary policy and exchange rates"
        self.assertIsNotNone(collect.make_article(item,official))
    def test_media_not_marked_official(self):
        source={"name":"媒体","url":"https://example.com/rss","kind":"media"}
        obj=collect.make_article(collect.parse_feed(RSS)[0],source)
        self.assertEqual(obj["verification"],"single_source")
    def test_fetch_parses_with_stub(self):
        source={"name":"央行","url":"https://example.com/rss","kind":"official"}
        objs=collect.collect_source(source,opener=lambda *args,**kwargs:FakeResponse(RSS))
        self.assertEqual(len(objs),2)
    def test_7_day_window_prunes_old_and_undated(self):
        fixed=collect.dt.datetime(2026,11,14,12,0,tzinfo=collect.dt.timezone.utc)
        source={"name":"央行","url":"https://example.com/rss","kind":"official"}
        recent={"title":"Fed interest rate decision","url":"https://example.com/recent","published_at":"2026-11-13T10:00:00Z"}
        old={"title":"Fed interest rate decision old","url":"https://example.com/old","published_at":"2026-11-06T10:00:00Z"}
        unknown={"title":"Fed statement undated","url":"https://example.com/unknown","published_at":None}
        irrelevant={"id":"offtopic","title":"Future of Artificial Intelligence and Democracy","url":"https://example.com/offtopic","published_at":"2026-11-13T10:00:00Z","topic":"其他","verification":"official"}
        class FixedDateTime(collect.dt.datetime):
            @classmethod
            def now(cls,tz=None):return fixed
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/"articles.json";s=Path(folder)/"status.json"
            p.write_text(json.dumps({"articles":[collect.make_article(old,source), collect.make_article(unknown,source), irrelevant]}))
            with mock.patch.object(collect,"DATA",p),mock.patch.object(collect,"STATUS",s),mock.patch.object(collect,"SOURCES",[source]),mock.patch.object(collect,"collect_source",return_value=[collect.make_article(recent,source)]),mock.patch.object(collect.dt,"datetime",FixedDateTime):
                collect.run()
            result=json.loads(p.read_text())
            self.assertEqual(len(result["articles"]),1)
            self.assertEqual(result["articles"][0]["url"],"https://example.com/recent")
            self.assertEqual(result["window_hours"],168)
    def test_zero_success_preserves_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            d=Path(folder)/"articles.json";s=Path(folder)/"status.json"
            d.write_text(json.dumps({"updated_at":"2026-11-13T00:00:00Z","articles":[{"id":"1","title":"Fed interest rate decision","source":"X","published_at":"2026-11-13T00:00:00Z","url":"https://example.com/a"}]}))
            with mock.patch.object(collect,"DATA",d), mock.patch.object(collect,"STATUS",s),mock.patch.object(collect,"collect_source",side_effect=OSError("blocked")):
                collect.run()
            new=json.loads(d.read_text())
            self.assertEqual(len(new["articles"]),1)
            self.assertEqual(new["updated_at"],"2026-11-13T00:00:00Z")
            self.assertEqual(json.loads(s.read_text())["success_count"],0)

if __name__=="__main__":
    unittest.main()

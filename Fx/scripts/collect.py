#!/usr/bin/env python3
"""Worldfirst FX RSS collector. Stdlib only; metadata, provenance and cautious rule tags."""
from __future__ import annotations
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / "data" / "articles.json"
STATUS = BASE / "data" / "status.json"
MAX_ITEMS = 400
WINDOW_DAYS = 7
SOURCES = [
    {"name": "美联储·货币政策", "url": "https://www.federalreserve.gov/feeds/press_monetary.xml", "kind": "official"},
    {"name": "美联储·讲话", "url": "https://www.federalreserve.gov/feeds/speeches.xml", "kind": "official"},
    {"name": "欧洲央行·官方发布", "url": "https://www.ecb.europa.eu/rss/press.html", "kind": "official"},
    {"name": "英为财情·外汇新闻", "url": "https://cn.investing.com/rss/news_1.rss", "kind": "media"},
    {"name": "英为财情·外汇分析", "url": "https://cn.investing.com/rss/forex.rss", "kind": "media"},
]
TOPICS = [
    ("货币政策", r"央行|美联储|联储|利率|降息|加息|联邦基金|federal reserve|fomc|monetary policy|central bank|interest rate|rate decision|ecb|powell|lagarde"),
    ("通胀与就业", r"通胀|物价|非农|就业|失业|cpi|inflation|employment|payroll|labou?r market|pce"),
    ("人民币", r"人民币|离岸|在岸|中国人民银行|美元兑人民币|usd.?cny|usd.?cnh|renminbi|yuan|china fx"),
    ("港币机制", r"港币|港元|香港金管局|联系汇率|usd.?hkd|hong kong dollar|hkma"),
    ("外汇市场", r"外汇|汇率|美元|欧元|日元|英镑|汇市|foreign exchange|forex|currency|dollar|yen|sterling|euro|dxy"),
    ("宏观经济", r"经济|增长|gdp|债券|国债|yield|economic|recession|tariff|trade|market"),
]
PAIRS = [
    ("USD/CNY", r"人民币|离岸|在岸|renminbi|yuan|cny|cnh|usd.?cny|usd.?cnh"),
    ("USD/HKD", r"港币|港元|港元联系汇率|hkd|hkma|hong kong dollar"),
    ("EUR/USD", r"欧元|欧洲央行|ecb|eur|euro|lagarde"),
    ("USD/JPY", r"日元|日本央行|日央行|jpy|yen|boj|ueda"),
    ("GBP/USD", r"英镑|英国央行|gbp|sterling|bank of england"),
]
GLOSS = {
    "货币政策": "涉及央行政策；请核对官方决议、公布时点和市场原有预期。",
    "通胀与就业": "涉及经济指标；需先核对统计口径、实际值、预期值及前值。",
    "人民币": "涉及人民币；应区分中间价、在岸与离岸汇率及新闻时点。",
    "港币机制": "涉及港元；需结合金管局官方数据与联系汇率制度审视。",
    "外汇市场": "涉及汇市动态；仅凭标题无法确定汇率方向与因果关系。",
    "宏观经济": "涉及宏观信息；其外汇影响需结合利差和市场预期核实。",
    "其他": "仅索引原文标题及来源，尚未形成经审核的市场结论。"
}

def utcnow():
    return dt.datetime.now(dt.timezone.utc)

def stamp(value):
    """Only accept parseable source dates; never silently label fetch time as publication time."""
    if not value:
        return None
    try:
        d = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        try:
            d = dt.datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if not d.tzinfo:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def clean(value, limit=240):
    plain = html.unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    return re.sub(r"\s+", " ", plain).strip()[:limit]

def url_clean(raw):
    try:
        u = urllib.parse.urlsplit(str(raw).strip())
        if u.scheme not in ("http", "https") or not u.netloc:
            return None
        pairs = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
        query = urllib.parse.urlencode([(k, v) for k, v in pairs if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}])
        return urllib.parse.urlunsplit((u.scheme, u.netloc.lower(), u.path or "/", query, ""))[:2048]
    except ValueError:
        return None

def local_tag(tag):
    return tag.rsplit("}", 1)[-1].lower()

def node_text(node, names):
    for child in node:
        if local_tag(child.tag) in names:
            if child.attrib.get("href"):
                return child.attrib["href"]
            if child.text:
                return child.text
    return None

def parse_feed(xml_bytes):
    """RSS2, RDF and Atom. Never parse or republish whole article bodies."""
    root = ET.fromstring(xml_bytes)
    items = [e for e in root.iter() if local_tag(e.tag) in {"item", "entry"}]
    parsed = []
    for node in items[:100]:
        title = clean(node_text(node, {"title"}))
        link = url_clean(node_text(node, {"link"}))
        date = stamp(node_text(node, {"pubdate", "published", "updated", "date"}))
        if title and link:
            parsed.append({"title": title, "url": link, "published_at": date})
    return parsed

def topic_pairs(title, official=False):
    text = title.lower()
    pairs = [pair for pair, pattern in PAIRS if re.search(pattern, text, re.I)]
    topic = next((name for name, regex in TOPICS if re.search(regex, text, re.I)), "其他")
    # Non-FX general items from non-FX feeds should be filtered out.
    relevant = topic != "其他" or official
    return topic, pairs, relevant

def make_article(item, src):
    topic, pairs, relevant = topic_pairs(item["title"], official=src["kind"] == "official")
    if not relevant:
        return None
    url = item["url"]
    return {
        "id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:16],
        "title": item["title"], "url": url, "source": src["name"],
        "source_url": src["url"], "published_at": item["published_at"],
        "topic": topic, "pairs": pairs,
        "verification": "official" if src["kind"] == "official" else "single_source",
        "analysis_mode": "rule_index",
        "summary": GLOSS[topic],
    }

def collect_source(src, opener=None):
    opener = opener or urllib.request.urlopen
    request = urllib.request.Request(src["url"], headers={
        "User-Agent": "WorldfirstFX/0.1 (RSS indexer; https://github.com/TempleHao/Worldfirst)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
    })
    with opener(request, timeout=16) as response:
        contents = response.read(3_000_001)
    if len(contents) > 3_000_000:
        raise ValueError("Feed exceeded 3 MB cap")
    raw = parse_feed(contents)
    return [a for i in raw if (a := make_article(i, src)) is not None]

def dedup(articles):
    merged = {}
    seen_titles = set()
    # Prefer official source for the same title, but never imply independent corroboration.
    ordered = sorted(articles, key=lambda a: (a.get("verification") != "official", a.get("source", "")))
    for a in ordered:
        key = a["id"]
        title_key = re.sub(r"[^\w]+", "", a["title"].casefold())[:160]
        if key in merged or title_key in seen_titles:
            continue
        merged[key] = a
        seen_titles.add(title_key)
    return sorted(merged.values(), key=lambda a: (a.get("published_at") or "", a["id"]), reverse=True)[:MAX_ITEMS]

def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return fallback

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def run():
    old = read_json(DATA, {"articles": [], "updated_at": None})
    statuses = []
    gathered = []
    success = 0
    for source in SOURCES:
        try:
            articles = collect_source(source)
            gathered.extend(articles)
            success += 1
            statuses.append({"name": source["name"], "ok": True, "count": len(articles), "error": None})
            print(f"OK {source['name']}: {len(articles)}")
        except (OSError, TimeoutError, ValueError, ET.ParseError) as exc:
            statuses.append({"name": source["name"], "ok": False, "count": 0, "error": type(exc).__name__})
            print(f"FAIL {source['name']}: {type(exc).__name__}", file=sys.stderr)
    current = utcnow()
    now_iso = current.isoformat().replace("+00:00", "Z")
    old_articles = old.get("articles", []) if isinstance(old.get("articles", []), list) else []
    cutoff = current - dt.timedelta(days=WINDOW_DAYS)
    items = []
    for a in gathered + old_articles:
        if a.get("sample"):
            continue
        when = a.get("published_at")
        parsed = stamp(when)
        if not parsed:
            # Strict 7x24-hour window: undated RSS cannot be displayed.
            continue
        date = dt.datetime.fromisoformat(parsed.replace("Z", "+00:00"))
        if date < cutoff or date > current:
            continue
        items.append(a)
    items = dedup(items)
    last_success = now_iso if success else old.get("updated_at")
    data = {
        "schema_version": 1, "updated_at": last_success, "attempted_at": now_iso,
        "articles": items, "sources": statuses, "analysis_mode": "rule_index",
        "window_hours": 168,
        "ai_brief": None,
        "message": "Model analysis is not automated by the GitHub script. Source metadata only."
    }
    write_json(DATA, data)
    write_json(STATUS, {
        "attempted_at": now_iso, "last_successful_at": last_success,
        "success_count": success, "total_sources": len(SOURCES),
        "sources": statuses, "article_count": len(items)
    })
    if success == 0:
        print("Warning: all RSS sources failed; preserved last successful data.", file=sys.stderr)
    print(f"articles={len(items)} sources_ok={success}/{len(SOURCES)}")

if __name__ == "__main__":
    run()

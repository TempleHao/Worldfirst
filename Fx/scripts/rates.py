#!/usr/bin/env python3
"""Official daily FX reference data: sourced, dated, tested; never fabricate a tick."""
from __future__ import annotations
import datetime as dt
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import sys
import urllib.request
import xml.etree.ElementTree as ET

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "data" / "market.json"
ECB_FEED = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"
ECB_PAGE = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"
HKMA_FEED = "https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/er-eeri-daily?offset=0&pagesize=30"
HKMA_PAGE = "https://apidocs.hkma.gov.hk/documentation/market-data-and-statistics/monthly-statistical-bulletin/er-ir/er-eeri-daily/"
KINDS = ("official_daily_reference", "official_daily_reference_cross")
PAIRS = (
    ("EUR/USD", "USD", None),
    ("USD/CNY", "CNY", "USD"),
    ("USD/JPY", "JPY", "USD"),
    ("USD/HKD", "HKD", "USD"),
    ("GBP/USD", "USD", "GBP"),
    ("EUR/GBP", "GBP", None),
)
MAX_BYTES = 2_000_000
MAX_AGE_DAYS = 14  # Keep older source observations identifiable, never pass as live.
def now_utc():
    return dt.datetime.now(dt.timezone.utc)
def iso(t):
    return t.isoformat().replace("+00:00", "Z")
def parse_date(s):
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        raise ValueError("invalid official observation date")
def decimal_rate(value):
    try:
        x = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        raise ValueError("invalid FX reference number")
    if not x.is_finite() or x <= 0 or x > 1_000_000:
        raise ValueError("unreasonable FX reference number")
    return x
def fetch(url, opener=None):
    opener = opener or urllib.request.urlopen
    req = urllib.request.Request(url, headers={
        "User-Agent": "WorldfirstFxReferenceData/1.0 (+https://github.com/TempleHao/Worldfirst)",
        "Accept": "application/xml, text/xml, application/json"
    })
    with opener(req, timeout=18) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("source data exceeded size limit")
    return body
def parse_ecb(xml_bytes):
    """Daily ECB table: each day Cube has currency -> EUR reference quotes."""
    root = ET.fromstring(xml_bytes)
    rows = {}
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] != "Cube" or "time" not in node.attrib:
            continue
        day = parse_date(node.attrib["time"]).isoformat()
        values = {}
        for child in node:
            if child.tag.rsplit("}", 1)[-1] == "Cube" and child.attrib.get("currency") and child.attrib.get("rate"):
                c = child.attrib["currency"].upper()
                if c in {"USD","CNY","JPY","HKD","GBP","CHF","CAD","SGD"}:
                    values[c] = decimal_rate(child.attrib["rate"])
        if values:
            rows[day] = values
    if not rows:
        raise ValueError("ECB returned no usable dated currency observations")
    return rows
def parse_hkma(json_bytes):
    obj = json.loads(json_bytes)
    result = obj.get("result", {})
    records = result.get("records", []) if isinstance(result, dict) else []
    if not isinstance(records, list):
        raise ValueError("invalid HKMA records")
    rows = {}
    for record in records:
        if not isinstance(record, dict) or not record.get("usd") or not record.get("end_of_day"):
            continue
        day = parse_date(record["end_of_day"]).isoformat()
        rows[day] = decimal_rate(record["usd"])
    if not rows:
        raise ValueError("HKMA returned no dated USD/HKD closing values")
    return rows
def make_instrument(pair, daily, source, page, method):
    """daily maps YYYY-MM-DD to Decimal or (for ECB) cross-calculated Decimal."""
    days = sorted(daily)
    if not days:
        return None
    selected = days[-30:]
    latest_day = selected[-1]
    latest = daily[latest_day]
    previous5 = daily[selected[-6]] if len(selected) >= 6 else None
    change = ((latest / previous5) - 1) * 100 if previous5 else None
    return {
        "pair": pair,
        "value": round(float(latest), 6),
        "date": latest_day,
        "source": source,
        "source_url": page,
        "method": method,
        "kind": "official_daily_reference_cross" if method == "same_day_cross" else "official_daily_reference",
        "change_5_published_days_pct": round(float(change), 3) if change is not None else None,
        "comparison_date": selected[-6] if previous5 is not None else None,
        "points": [{"date":d, "value":round(float(daily[d]),6)} for d in selected],
    }
def ecb_instruments(rows):
    items = []
    for pair, numerator, denominator in PAIRS:
        daily = {}
        for day, values in rows.items():
            if numerator not in values or (denominator and denominator not in values):
                continue
            daily[day] = values[numerator] / values[denominator] if denominator else values[numerator]
        if daily:
            items.append(make_instrument(pair, daily, "欧洲央行 ECB", ECB_PAGE,
                                         "same_day_cross" if denominator else "direct_eur_reference"))
    return items
def hkma_instrument(rows):
    return make_instrument("USD/HKD", rows, "香港金管局 HKMA", HKMA_PAGE, "direct_hkd_close")
def read_old():
    try:
        old = json.loads(OUT.read_text(encoding="utf-8"))
        return old if isinstance(old, dict) else {}
    except (OSError, ValueError):
        return {}
def write_data(doc):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
def collect(opener=None):
    current = now_utc()
    prior = read_old()
    existing = {r["pair"]:r for r in prior.get("instruments",[]) if isinstance(r,dict) and r.get("pair")}
    statuses=[]
    successes=0
    for name, url, parser in [
        ("欧洲央行每日参考汇率", ECB_FEED, lambda raw: ecb_instruments(parse_ecb(raw))),
        ("香港金管局港元收市价", HKMA_FEED, lambda raw: [hkma_instrument(parse_hkma(raw))])
    ]:
        try:
            data = parser(fetch(url, opener))
            if not data:
                raise ValueError("no rate observations from source")
            # Official latest date must not be in the future relative to UTC.
            good = [a for a in data if parse_date(a["date"]) <= current.date()]
            if not good:
                raise ValueError("only future dates in source")
            for item in good:
                # HKMA direct USD/HKD supersedes ECB-derived USD/HKD.
                previous = existing.get(item["pair"])
                if (previous is None or item["date"] > previous.get("date", "")
                    or (item["date"] == previous.get("date") and name.startswith("香港"))):
                    existing[item["pair"]] = item
            successes+=1
            newest = max(x["date"] for x in good)
            age = (current.date() - parse_date(newest)).days
            statuses.append({"name":name,"ok":True,"count":len(good),"error":None,
                            "last_observation_date":newest,
                            "date_fresh":age<=7})
            print(f"OK {name}: {len(good)} instruments")
        except (OSError, TimeoutError, ValueError, KeyError, ET.ParseError, TypeError, json.JSONDecodeError) as exc:
            statuses.append({"name":name,"ok":False,"count":0,"error":type(exc).__name__,
                             "last_observation_date":None,"date_fresh":False})
            print(f"FAIL {name}: {type(exc).__name__}",file=sys.stderr)
    items = sorted(existing.values(), key=lambda r: (PAIRS.index(next(p for p in PAIRS if p[0]==r["pair"])) if r["pair"] in [p[0] for p in PAIRS] else 999))
    # On failure, preserve previously confirmed reference prices with original observation dates.
    # The front-end marks them old; attempted_at cannot become quote_date.
    old_success=prior.get("last_successful_at")
    return {
        "schema_version":1,
        "attempted_at":iso(current),
        "last_successful_at":iso(current) if successes else old_success,
        "quote_type":"official_daily_reference_not_realtime_or_executable",
        "instruments":items,
        "sources":statuses,
        "notice":"官方工作日参考/收市数据；ECB衍生交叉汇率使用同日EUR报价相除；非实时、非银行可成交价。无USD/CNH官方报价，不予填充。"
    }
def run():
    data=collect()
    write_data(data)
    print(f"official_reference_instruments={len(data['instruments'])} live_sources={sum(s['ok'] for s in data['sources'])}/2")
if __name__=="__main__":
    run()

#!/usr/bin/env python3
"""Experimental public RSS aggregation. This is not full-web/social media monitoring."""
import hashlib
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime, format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

DATA = Path(__file__).resolve().parents[1] / "data"
QUERIES = {
 "worldfirst": ('"WorldFirst" OR "万里汇"',["worldfirst","万里汇"]),
 "airwallex": ('"Airwallex" OR "空中云汇"',["airwallex","空中云汇"]),
 "payoneer": ('"Payoneer" OR "派安盈"',["payoneer","派安盈"]),
 "xtransfer": ('"XTransfer"',["xtransfer"]),
 "lianlian": ('"连连国际" OR "连连数字" OR "LianLian Global"',["连连国际","连连数字","lianlian"]),
 "pingpong": ('"PingPong" "跨境支付" OR "PingPong Payments"',["pingpong"]),
 "coral": ('"珊瑚跨境" OR "CoralGlobal"',["珊瑚跨境","coralglobal"]),
 "sunrate": ('"SUNRATE" OR "寻汇"',["sunrate","寻汇"]),
 "skyee": ('"Skyee"',["skyee"])
}
NAMES = {"worldfirst":"万里汇","airwallex":"空中云汇","payoneer":"派安盈","xtransfer":"XTransfer","lianlian":"连连国际","pingpong":"PingPong","coral":"珊瑚跨境","sunrate":"寻汇","skyee":"Skyee"}
NOW = datetime.now(timezone.utc)
CUTOFF = (NOW - timedelta(days=35)).date().isoformat()

def classify(s):
 s=s.lower()
 if any(t in s for t in ("收购","并购","acquisition","merger")):return "资本并购"
 if any(t in s for t in ("处罚","合规","监管","牌照","注册","regulation","license")):return "监管合规"
 if any(t in s for t in ("agent","ai","智能体","稳定币","stablecoin")):return "AI与产品"
 if any(t in s for t in ("合作","partner","签署","联合")):return "品牌合作"
 return "市场动态"

def collect(key, query, aliases):
 params=urllib.parse.urlencode({"q":"("+query+") when:14d","hl":"zh-CN","gl":"CN","ceid":"CN:zh-Hans"})
 req=urllib.request.Request("https://news.google.com/rss/search?"+params,headers={"User-Agent":"Mozilla/5.0 WorldFirstRadar/1.0"})
 with urllib.request.urlopen(req,timeout=18) as r: root=ET.fromstring(r.read(2000000))
 found=[]
 for item in root.findall("./channel/item")[:35]:
  title=(item.findtext("title") or "").strip()
  link=(item.findtext("link") or "").strip()
  rawdate=item.findtext("pubDate") or ""
  try:
   date=parsedate_to_datetime(rawdate).date().isoformat()
  except (TypeError, ValueError, IndexError):continue
  if not title or not link or not (CUTOFF<=date<=NOW.date().isoformat()):continue
  if not any(x in title.lower() for x in aliases):continue
  if key=="pingpong" and not any(x in title.lower() for x in ("支付","跨境","payment","收款","结算","金融")):continue
  title=title[:180]
  uid=hashlib.sha256((key+link).encode()).hexdigest()[:18]
  found.append({"id":"search-"+uid,"company":key,"date":date,"title":title,
   "summary":title[:29]+("…" if len(title)>29 else ""), "category":classify(title),
   "priority":"normal","source":item.findtext("source") or "Google News",
   "source_type":"search","url":link,"status":"unverified"})
 return found

def write_feeds(payload, status):
 items=payload["items"]
 (DATA/"articles.json").write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 (DATA/"status.json").write_text(json.dumps(status,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 lines=["# WorldFirst Radar｜跨境支付情报流","","搜索线索未经人工核验。此数据不等于全网舆情覆盖。",""]
 for a in items[:120]:
  lines.append("- **"+a["date"]+"｜"+NAMES[a["company"]]+"** "+a["summary"]+" [原文]("+a["url"]+")（"+a["status"]+"）")
 (DATA/"latest.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
 rss=['<?xml version="1.0" encoding="UTF-8"?>','<rss version="2.0"><channel><title>WorldFirst Radar</title><link>https://templehao.github.io/Worldfirst/radar/</link><description>跨境支付九家企业新闻与待核验搜索线索</description>']
 for a in items[:120]:
  date=datetime.fromisoformat(a["date"]).replace(tzinfo=timezone.utc)
  rss.append("<item><title>"+escape(NAMES[a["company"]]+"｜"+a["summary"])+"</title><link>"+escape(a["url"])+"</link><guid isPermaLink=\"false\">"+escape(a["id"])+"</guid><pubDate>"+format_datetime(date)+"</pubDate></item>")
 rss.append("</channel></rss>")
 (DATA/"feed.xml").write_text("\n".join(rss)+"\n",encoding="utf-8")

def main():
 payload=json.loads((DATA/"articles.json").read_text(encoding="utf-8"))
 try: previous=json.loads((DATA/"status.json").read_text(encoding="utf-8"))
 except (OSError,ValueError):previous={}
 retained={a["id"]:a for a in payload["items"] if a.get("status")=="verified" or a.get("date","")>=CUTOFF}
 outcome={}
 successes=0;new_count=0
 for key,(query,aliases) in QUERIES.items():
  try:
   found=collect(key,query,aliases)
   successes+=1
   outcome[key]={"ok":True,"matched":len(found)}
   for item in found:
    if item["id"] not in retained:
     retained[item["id"]]=item
     new_count+=1
  except Exception as e:
   outcome[key]={"ok":False,"error":str(e)[:150]}
 payload["items"]=sorted(retained.values(),key=lambda a:a["date"],reverse=True)[:250]
 payload["updated_at"]=NOW.isoformat()
 payload["coverage_notice"]="已核实的历史样本与实验性公开搜索RSS线索；不包含全量社媒数据"
 status={"latest_outcome":"ok" if successes else "failed","last_attempt_at":NOW.isoformat(),
   "last_success_at":NOW.isoformat() if successes else previous.get("last_success_at"),
   "succeeded_sources":successes,"attempted_sources":len(QUERIES),"new_items":new_count,
   "sources":outcome,"notes":"公开 Google News RSS 实验性采集，不能推算全网声量。"}
 write_feeds(payload,status)
 print(json.dumps({"succeeded_sources":successes,"new_items":new_count,"total_records":len(payload["items"])},ensure_ascii=False))

if __name__=="__main__":main()

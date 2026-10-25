#!/usr/bin/env python3
"""Social-source adapters (public search discovery + optional authorised providers).

This module never logs in to social sites, circumvents anti-bot controls, or
pretends that search snippets are social engagement analytics.
"""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse
from collect import DATA, QUERIES, NAMES, write_feeds
NOW=datetime.now(timezone.utc)
RECENT=NOW-timedelta(days=35)
PLATFORMS={
 "wechat":{"name":"微信公众号","site":"mp.weixin.qq.com","enabled":True,"method":"google-news-index","expected":"public-index-only"},
 "xiaohongshu":{"name":"小红书","site":"xiaohongshu.com","enabled":True,"method":"google-news-index","expected":"public-index-only"},
 "douyin":{"name":"抖音","site":"douyin.com","enabled":True,"method":"google-news-index","expected":"public-index-only"},
 "zhihu":{"name":"知乎","site":"zhihu.com","enabled":True,"method":"google-news-index","expected":"public-index-only"},
}
USERAGENT="WorldFirstRadar/1.1 (+public-index-monitor; no platform credential bypass)"
def fetched_rss(platform,brand,phrase):
 site=PLATFORMS[platform]["site"]
 q=f"({phrase}) site:{site} when:14d"
 url="https://news.google.com/rss/search?"+urllib.parse.urlencode({"q":q,"hl":"zh-CN","gl":"CN","ceid":"CN:zh-Hans"})
 request=urllib.request.Request(url,headers={"User-Agent":USERAGENT})
 with urllib.request.urlopen(request,timeout=12) as r:
  root=ET.fromstring(r.read(1300000))
 found=[]
 for ent in root.findall("./channel/item")[:35]:
  title=(ent.findtext("title") or "").strip()
  link=(ent.findtext("link") or "").strip()
  try:
   when=parsedate_to_datetime(ent.findtext("pubDate") or "")
   when=when.astimezone(timezone.utc) if when.tzinfo else when.replace(tzinfo=timezone.utc)
  except (ValueError,TypeError,IndexError):continue
  if not title or not link or not (RECENT<=when<=NOW+timedelta(days=1)):continue
  brandterms=QUERIES[brand][1]
  if not any(w.lower() in title.lower() for w in brandterms):continue
  if brand=="pingpong" and not any(w in title.lower() for w in ["跨境","支付","payment","收款","金融"]):continue
  uid=hashlib.sha256(("socialindex:"+platform+":"+brand+":"+link).encode()).hexdigest()[:20]
  found.append({"id":"social-index-"+uid,"company":brand,"date":when.date().isoformat(),
   "date_basis":"publication_index","title":title[:180],"summary":title[:29]+("…" if len(title)>29 else ""),
   "category":"社交讨论","priority":"normal","source":(ent.findtext("source") or "Google News公开索引"),
   "source_type":"search","channel":platform,"platform":platform,"discovery_method":"public_news_index",
   "link_origin":"google-news-indirect","url":link,"status":"unverified",
   "rights":"index_snippet_only","coverage":"partial_index_only","metrics":None})
 return found

def value(obj,*names):
 if not isinstance(obj,dict):return None
 low={str(k).lower():v for k,v in obj.items()}
 for n in names:
  v=low.get(n.lower())
  if v is not None:return v
 return None

def extract_records(response,depth=0):
 if isinstance(response,list):
  return response if all(isinstance(x,dict) for x in response) else []
 if depth>4 or not isinstance(response,dict):return []
 for name in ("items","results","list","docs","records","hits","data"):
  v=value(response,name)
  if isinstance(v,(list,dict)):
   arr=extract_records(v,depth+1)
   if arr:return arr
 return []

def authorised_zhihu(brand,phrase,token):
 """Uses published GET Query/Bearer/timestamp example; shape still must be verified with a real key."""
 endpoint="https://developer.zhihu.com/api/v1/content/zhihu_search"
 name=QUERIES[brand][1][0]
 req=urllib.request.Request(endpoint+"?"+urllib.parse.urlencode({"Query":name}),
  headers={"Authorization":"Bearer "+token,"X-Request-Timestamp":str(int(time.time())),
           "Content-Type":"application/json","User-Agent":USERAGENT})
 with urllib.request.urlopen(req,timeout=20) as response:
  data=json.load(response)
 # Do not claim success with unknown provider schema.
 records=extract_records(data)
 if not records:return [],"empty_or_unrecognized_schema"
 out=[]
 for a in records[:30]:
  title=str(value(a,"title","name","question_title","Title") or "").strip()
  url=str(value(a,"url","link","share_url","target_url","content_url") or "").strip()
  snippet=str(value(a,"summary","abstract","description","excerpt") or "").strip()
  published=value(a,"published_at","publish_time","created_at","created_time")
  if isinstance(published,(int,float)):
   date=datetime.fromtimestamp(published/1000 if published>1e12 else published,tz=timezone.utc).date().isoformat()
   basis="published"
  elif isinstance(published,str) and re.match(r"^\d{4}-\d\d-\d\d",published):
   date=published[:10];basis="published"
  else:
   date=NOW.date().isoformat();basis="first_seen_not_publication"
  if not title or not url:continue
  host=(urlparse(url).hostname or "").lower()
  if not (host=="zhihu.com" or host.endswith(".zhihu.com")):continue
  if not any(t.lower() in (title+" "+snippet).lower() for t in QUERIES[brand][1]):continue
  uid=hashlib.sha256(("zhihuapi:"+brand+":"+url).encode()).hexdigest()[:20]
  out.append({"id":"social-official-"+uid,"company":brand,"date":date,"date_basis":basis,
   "title":title[:180],"summary":snippet[:100] if snippet else title[:100],
   "category":"社交讨论","priority":"normal","source":"知乎开放平台",
   "source_type":"social","channel":"zhihu","platform":"zhihu",
   "discovery_method":"official_authorised_api","link_origin":"direct","url":url,
   "status":"unverified","rights":"authorised_index_snippet",
   "coverage":"authorised_api_query_not_full_platform","metrics":None})
 return out,"ok"

def licensed_import(path:Path):
 """Accept narrowly licensed, normalised partner data. Empty by default."""
 if not path.exists():return [],"not_configured"
 raw=json.loads(path.read_text(encoding="utf-8"))
 if not isinstance(raw,dict) or not raw.get("rights_confirmed"):
  return [],"rejected_missing_rights_confirmation"
 if not raw.get("permitted_to_display_excerpt"):
  return [],"rejected_no_display_permission"
 rows=raw.get("items",[])
 if not isinstance(rows,list):return [],"invalid_item_list"
 out=[]
 for row in rows[:1000]:
  if not isinstance(row,dict):continue
  platform=row.get("platform");brand=row.get("company")
  if platform not in PLATFORMS or brand not in NAMES:continue
  title=str(row.get("title") or "").strip()[:180];url=str(row.get("url") or "").strip()
  if not title or not url.startswith("https://"):continue
  dt=str(row.get("published_at") or "")
  date=dt[:10] if re.match(r"^\d{4}-\d{2}-\d{2}",dt) else NOW.date().isoformat()
  basis="published" if dt else "first_seen_not_publication"
  if not any(w.lower() in (title+" "+str(row.get("excerpt") or "")).lower() for w in QUERIES[brand][1]):
   continue
  m=row.get("engagement") or {}
  metrics={key:int(m[key]) for key in ("views","likes","comments","shares") if key in m and isinstance(m[key],int) and m[key]>=0} if isinstance(m,dict) else {}
  uid=hashlib.sha256(("vendor:"+platform+":"+brand+":"+url).encode()).hexdigest()[:20]
  out.append({"id":"social-licensed-"+uid,"company":brand,"date":date,"date_basis":basis,
   "title":title,"summary":str(row.get("excerpt") or title)[:220],
   "category":"社交讨论","priority":"normal","source":str(row.get("publisher") or platform)[:80],
   "source_type":"social","channel":platform,"platform":platform,
   "discovery_method":"licensed_provider_import","link_origin":"direct",
   "url":url,"status":"unverified","rights":"provider_approved_excerpt",
   "coverage":"contract_bound","metrics":metrics or None,
   "metrics_observed_at":str(row.get("observed_at") or "") or None})
 return out,"ok"

def main():
 payload=json.loads((DATA/"articles.json").read_text(encoding="utf-8"))
 health=json.loads((DATA/"status.json").read_text(encoding="utf-8"))
 retained={x["id"]:x for x in payload.get("items",[]) if not x.get("id","").startswith("social-") or x.get("date","")>=RECENT.date().isoformat()}
 status={"generated_at":NOW.isoformat(),"platforms":{},
         "notes":"公开新闻搜索索引≠平台全文/评论/真实声量。API未授权的不作联网API成功声称。",
         "authorised_api":{"zhihu":"not_configured","douyin":"not_configured","wechat":"not_configured","xiaohongshu":"not_configured"},
         "licensed_provider":"not_configured"}
 jobs=[(p,brand,query) for p in PLATFORMS for brand,(query,_terms) in QUERIES.items()]
 stats={k:{"index_requests_ok":0,"index_requests_failed":0,"indexed_items":0,
           "source_quality":"partial_public_index"} for k in PLATFORMS}
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
  fut={pool.submit(fetched_rss,*j):j for j in jobs}
  for future in concurrent.futures.as_completed(fut):
   platform,brand,_=fut[future]
   try:
    records=future.result()
    stats[platform]["index_requests_ok"]+=1
    stats[platform]["indexed_items"]+=len(records)
    for r in records:retained[r["id"]]=r
   except Exception as exc:
    stats[platform]["index_requests_failed"]+=1
    stats[platform]["last_error"]=str(exc)[:140]
 token=os.getenv("ZHIHU_ACCESS_SECRET","").strip()
 if token:
  success=0;count=0;errors=[]
  for brand,(query,_) in QUERIES.items():
   try:
    records,result=authorised_zhihu(brand,query,token)
    if result=="ok":success+=1
    else:errors.append(brand+":"+result)
    for r in records:retained[r["id"]]=r
    count+=len(records)
   except Exception as exc:errors.append(brand+":"+str(exc)[:90])
  status["authorised_api"]["zhihu"]={"requests_ok":success,"items":count,
                                  "state":"ok" if success else "failed_or_unrecognized",
                                  "errors":errors[:5]}
 imported,import_status=licensed_import(DATA.parent/"inbound"/"licensed-social.json")
 for r in imported:retained[r["id"]]=r
 status["licensed_provider"]= {"state":import_status,"items":len(imported)}
 for platform,st in stats.items():
  st["total_available_records"]=sum(1 for a in retained.values() if a.get("channel")==platform)
  if st["index_requests_ok"]==0:st["state"]="index_unavailable"
  elif st["indexed_items"]==0:st["state"]="connected_zero_matching_results"
  else:st["state"]="public_index_leads_only"
  status["platforms"][platform]=st
 payload["items"]=sorted(retained.values(),key=lambda x:str(x.get("date","")),reverse=True)[:500]
 write_feeds(payload,health)
 (DATA/"social-status.json").write_text(json.dumps(status,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print(json.dumps({"social_leads":{k:v["indexed_items"] for k,v in stats.items()},
                   "api":status["authorised_api"]["zhihu"],
                   "vendor":import_status,"total":len(payload["items"])},ensure_ascii=False))
if __name__=="__main__":main()

#!/usr/bin/env python3
"""Transparent, conservative reputational-risk triage for nine payment brands.
Signals ≠ verified incidents. Methodology informed by BIS SRP30, DBS 2025,
HSBC public reputational-risk policy and AMEC evaluation; numerical thresholds
are LOCAL provisional heuristics, never presented as a bank's formula.
"""
from __future__ import annotations
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
MODEL_VERSION = "reputation-v1.0"
# Financial/operational consequences, not generic negative vocabulary.
HAZARDS = {
 "资金与账户": (4, ("资金冻结","账户冻结","冻结账户","冻结客户","无法提现","无法提款","提不出","提现失败","出金失败","资金滞留","扣押资金","无法取回资金","转账资金丢失","资金失踪")),
 "数据与安全": (4, ("数据泄露","信息泄露","客户资料泄露","数据被盗","黑客入侵","重大安全漏洞","security breach","data breach")),
 "监管与法律": (4, ("被罚款","遭罚款","罚单","行政处罚","被监管处罚","受到处罚","监管调查","涉嫌洗钱","涉嫌欺诈","遭制裁","涉嫌违规","洗钱指控","诉讼败诉","被起诉","fine imposed","fined for","regulatory sanction")),
 "服务故障": (3, ("大规模故障","系统故障","服务中断","支付故障","大面积宕机","交易中断","无法收款","无法转账","大面积延迟","outage","service disruption")),
 "客户争议": (2, ("客户投诉","消费者投诉","用户投诉","遭投诉","维权","大规模投诉","客户不满","遭质疑","涉嫌虚假宣传","投诉激增")),
}
BENEFITS = {
 "用户正向评价": ("用户好评","客户好评","满意度提升","赢得好评","广受好评","用户推荐","客户称赞","获得用户认可"),
 "业务成果": ("营收增长","利润增长","交易量增长","实现增长","获批牌照","正式获批","斩获大奖","荣获大奖","获得殊荣","提升了满意度"),
}
DENIAL = ("否认","辟谣","澄清","不实","未发生","未发现","并未","不存在","未受到","驳斥","已解决","已恢复","解除冻结")
QUESTION = ("？","?","疑似","传闻","网传","据称","或将","可能","据传")
INDEPENDENCE = {"official": "企业自身发布", "press": "企业营销通稿", "media": "第三方报道", "search": "搜索索引线索"}
METHOD_SOURCES = [
 {"institution":"HSBC","name":"汇丰声誉风险框架","url":"https://www.hsbc.com/who-we-are/esg-and-responsible-business/managing-risk/reputational-risk"},
 {"institution":"DBS","name":"DBS 2025年年报：声誉风险管理","url":"https://www.dbs.com/iwov-resources/images/investors/annual-report/dbs-annual-report-2025.pdf"},
 {"institution":"Deutsche Bank","name":"德意志银行2025年报：声誉风险框架","url":"https://investor-relations.db.com/files/documents/other-presentations-and-events/2025/Annual-Report-2025.pdf?language_id=1"},
 {"institution":"BCBS","name":"巴塞尔框架SRP30声誉风险定义","url":"https://www.bis.org/basel_framework/chapter/SRP/30.htm"},
 {"institution":"AMEC","name":"整合传播评估框架","url":"https://amecorg.com/amecframework/"},
]
def normalize_title(s):
 s = re.sub(r"\s*[-—–]\s*[^-—–]{2,35}$","",str(s).lower())
 return re.sub(r"[^a-z0-9\u4e00-\u9fff]+","",s)

def matches(text, terms):
 return [w for w in terms if w.casefold() in text.casefold()]

def analyze_tone(item):
 """Target-branded title/summary polarity. Neutral ≠ endorsement; uncertainty preserved."""
 title = str(item.get("title") or "")
 desc = str(item.get("summary") or "")
 content = (title+" "+(desc if desc not in title else "")).lower()
 hazards = [(kind,level,word) for kind,(level,terms) in HAZARDS.items() for word in matches(content,terms)]
 good = [(kind,word) for kind,terms in BENEFITS.items() for word in matches(content,terms)]
 uncertain = matches(content,DENIAL)
 tentative = matches(content,QUESTION)
 reasons=[]
 if hazards: reasons.append("风险措辞："+ "、".join(dict.fromkeys(w for _,_,w in hazards))[:90])
 if good: reasons.append("正面评价："+ "、".join(dict.fromkeys(w for _,w in good))[:90])
 if uncertain: reasons.append("包含否认、澄清或修复措辞，需核对事件事实")
 if tentative: reasons.append("标题含疑问或未经证实表述")
 if hazards and (uncertain or tentative):
  tone="待研判"
 elif hazards and good:
  tone="混合"
 elif hazards:
  tone="负面"
 elif good:
  tone="正面"
 else:
  tone="中性"
  reasons.append("标题未包含足以确认评价方向的明确线索")
 grade = max([x[1] for x in hazards],default=0)
 # The current collectors only index titles: no deep body/engagement metrics.
 confidence = 0.55 if tone in ("负面","正面") else 0.40
 if item.get("source_type") == "search":
  confidence -= 0.15
 if tone in ("混合","待研判"):
  confidence = min(confidence,0.3)
 confidence = round(max(0.15,confidence),2)
 return {"label":tone,"confidence":confidence,"basis":"标题/摘要词项初筛，非全文语义模型","reasons":reasons,
         "topic":hazards[0][0] if hazards else None,"materiality":grade,
         "requires_review":tone in ("负面","混合","待研判")}

def source_identity(item):
 src = str(item.get("source") or "").strip().lower()
 # Google News search is an index; publisher is source field if specified.
 if not src or src in ("google news","google news 聚合","谷歌新闻"):
  return "未知发布方"
 src = re.sub(r"（.*?）|\(.*?\)|\s+","",src)
 return src[:90]

def same_event(a,b):
 if a.get("company") != b.get("company"):return False
 # Similar daily market announcements are not one incident.
 try:
  if abs((date.fromisoformat(a["date"])-date.fromisoformat(b["date"])).days)>2:
   return False
 except (ValueError,KeyError,TypeError):
  return False
 # Different deal sizes or buyback quantities should not be merged.
 na = re.findall(r"\d+(?:\.\d+)?",str(a.get("title","")))
 nb = re.findall(r"\d+(?:\.\d+)?",str(b.get("title","")))
 if na and nb and set(na).isdisjoint(nb):
  return False
 ta = normalize_title(a.get("title",""))
 tb = normalize_title(b.get("title",""))
 if min(len(ta),len(tb)) < 12:return ta == tb
 return SequenceMatcher(None,ta,tb).ratio() >= 0.80

def clusters(items):
 """Greedy near-duplicate grouping; do not merge every mention of a category."""
 buckets=defaultdict(list)
 for a in items:
  if not a.get("id"):continue
  key=a.get("company") or "unknown"
  groups=buckets[key]
  target=next((g for g in groups if same_event(a,g[0])),None)
  if target is None:groups.append([a])
  else:target.append(a)
 return [g for group in buckets.values() for g in group]

def event_risk(group):
 """Severity + independent source diversity + evidence. Negative is a prerequisite."""
 tones=[i["sentiment"]["label"] for i in group]
 negative=[i for i in group if i["sentiment"]["materiality"]>0]
 pubs=set(source_identity(a) for a in group)
 pubs.discard("未知发布方")
 verified=[a for a in group if a.get("status")=="verified" and a.get("source_type") in ("media","official")]
 # Verification in old dataset means original article available, not allegation confirmed.
 max_hazard=max((a["sentiment"]["materiality"] for a in group),default=0)
 independent=len(set(source_identity(a) for a in group if a.get("source_type") in ("media","search")))
 official=len(set(source_identity(a) for a in group if a.get("source_type")=="official"))
 total=len(group)
 # Spread is indexed distinct publishers, NOT audiences, impressions, or platform reach.
 spread=min(20,max(0,independent-1)*5)
 verification=min(15,len(verified)*5)
 severity={0:0,2:27,3:44,4:63}.get(max_hazard,0)
 score=min(100,severity+spread+verification) if negative else 0
 if not negative:
  level="一般"; comment="未见标题级负面风险线索"
 elif not verified:
  level="待核验"; comment="仅凭未核验搜索线索，不认定危机已成立"
 elif score>=75 and independent>=2 and len(verified)>=2:
  level="严重"; comment="多方独立报道的高影响事项，建议立即人工复核"
 elif score>=55 and len(verified)>=1:
  level="较高"; comment="潜在高影响事项，建议人工核实并评估升级"
 elif score>=30:
  level="关注"; comment="发现负面线索，纳入人工关注清单"
 else:
  level="一般"; comment="低强度负面线索"
 if any(x["sentiment"]["label"] == "待研判" for x in group) and not verified and negative:
  level="待核验"
 key=min(a["id"] for a in group)
 eid="event-"+hashlib.sha256((group[0]["company"]+"|"+key).encode()).hexdigest()[:12]
 return {
   "id":eid,"company":group[0]["company"],
   "headline":sorted(group,key=lambda a:(a.get("status")=="verified",len(a.get("title",""))),reverse=True)[0]["title"],
   "date":max(a.get("date","") for a in group),
   "risk_level":level,"risk_score":score,
   "materiality":max_hazard,
   "independent_publishers":independent,
   "publisher_count":len(pubs),
   "official_sources":official,
   "mention_count":total,
   "source_platforms_observed":["公开网络/新闻检索"],  # no invented TikTok etc reach
   "status":"初筛／人工审核待完成",
   "reason":comment,
   "evidence_notes":["标题级事件严重性（0至63分）","不同发布方覆盖（0至20分）","可定位原文证据（0至15分）"],
   "items":[a["id"] for a in group],
 }

def analyze(payload):
 items=payload.get("items",[])
 for a in items:
  a["sentiment"]=analyze_tone(a)
 events=[event_risk(g) for g in clusters(items)]
 byid={a["id"]:a for a in items}
 for ev in events:
  for item_id in ev["items"]:
   item=byid[item_id]
   item["crisis"]={"level":ev["risk_level"],"score":ev["risk_score"],"event_id":ev["id"],
      "distinct_publishers":ev["independent_publishers"],"rationale":ev["reason"]}
 levels=Counter(e["risk_level"] for e in events)
 tones=Counter(a["sentiment"]["label"] for a in items)
 report={
   "schema_version":"1.0","model_version":MODEL_VERSION,
   "generated_at":datetime.now(timezone.utc).isoformat(),
   "scope":"九家跨境支付公司，当前收录新闻，未覆盖全部社交平台",
   "limitations":["当前仅分析标题和摘要，缺少正文、评论、浏览量和真实互动数据",
       "Google News是检索入口，不代表Google自身报道或全网声量",
       "索引线索无核实证据时不得判定真实危机",
       "评分及阈值为本项目试行规则，非任何银行官方量化标准",
       "同事件转载去重仅为相似标题启发式，可能漏合并或误合并",
       "没有历史完整覆盖基线，不计算可信的同比/暴增百分比"],
   "overview":{"articles":len(items),"events":len(events),"sentiment":dict(tones),
      "crisis":dict(levels),"needs_review":sum(a["sentiment"]["requires_review"] for a in items),
      "high_risk_verified_events":sum(e["risk_level"] in ("较高","严重") for e in events)},
   "events":sorted(events,key=lambda x:(x["risk_score"],x["date"]),reverse=True),
   "method_references":METHOD_SOURCES,
 }
 return payload,report

def main(argv=None):
 argv=argv or sys.argv[1:]
 path=Path(argv[0]) if argv else DATA/"articles.json"
 obj=json.loads(path.read_text(encoding="utf-8"))
 obj,report=analyze(obj)
 path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 out=path.parent/"reputation.json"
 out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print(json.dumps(report["overview"],ensure_ascii=False))

if __name__=="__main__":
 main()

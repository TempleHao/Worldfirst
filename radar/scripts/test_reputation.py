#!/usr/bin/env python3
import copy
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from reputation import analyze_tone,analyze,clusters

def make(i,title,source="资讯网",source_type="search",status="unverified"):
 return {"id":str(i),"company":"worldfirst","date":"2026-10-23","title":title,
  "summary":title[:28],"category":"市场动态","priority":"normal",
  "source":source,"source_type":source_type,"url":"https://example.org/"+str(i),"status":status}

class ReputationTests(unittest.TestCase):
 def test_negative_frozen_account(self):
  self.assertEqual(analyze_tone(make(1,"万里汇客户投诉账户冻结无法提现"))["label"],"负面")
 def test_neutral_partnership(self):
  self.assertEqual(analyze_tone(make(1,"万里汇与企业签署合作协议"))["label"],"中性")
 def test_positive_real_praise(self):
  self.assertEqual(analyze_tone(make(1,"万里汇获得用户好评"))["label"],"正面")
 def test_negation_not_automatic_negative(self):
  self.assertEqual(analyze_tone(make(1,"万里汇否认客户数据泄露传闻"))["label"],"待研判")
 def test_mixed_case(self):
  self.assertEqual(analyze_tone(make(1,"万里汇用户好评与客户投诉并存"))["label"],"混合")
 def test_financial_registration_not_penalty(self):
  self.assertEqual(analyze_tone(make(1,"万里汇完成加拿大支付服务商注册"))["label"],"中性")
 def test_no_risk_for_viral_neutral(self):
  a=[make(i,"万里汇与企业签署合作协议",str(i),"media","verified") for i in range(12)]
  _,rep=analyze({"items":a,"companies":{"worldfirst":"万里汇"}})
  self.assertTrue(all(e["risk_score"]==0 for e in rep["events"]))
 def test_single_indexed_negative_unverified(self):
  a=[make(1,"万里汇被监管处罚并罚款")]
  _,rep=analyze({"items":a,"companies":{"worldfirst":"万里汇"}})
  self.assertEqual(rep["events"][0]["risk_level"],"待核验")
 def test_two_independent_media_escalate(self):
  a=[make(1,"万里汇出现资金冻结导致客户无法提现","甲报","media","verified"),
     make(2,"万里汇出现资金冻结导致客户无法提现","乙报","media","verified")]
  _,rep=analyze({"items":a,"companies":{"worldfirst":"万里汇"}})
  self.assertEqual(len(rep["events"]),1)
  self.assertEqual(rep["events"][0]["risk_level"],"严重")
  self.assertEqual(rep["events"][0]["independent_publishers"],2)
 def test_duplicate_same_publisher_not_counted_twice(self):
  a=[make(1,"万里汇出现资金冻结导致客户无法提现","甲报","media","verified"),
     make(2,"万里汇出现资金冻结导致客户无法提现","甲报","media","verified")]
  _,rep=analyze({"items":a})
  self.assertEqual(rep["events"][0]["independent_publishers"],1)
 def test_different_issues_not_merged(self):
  a=[make(1,"万里汇与企业签署合作协议"),
     make(2,"万里汇某客户账户出现大面积资金冻结")]
  self.assertEqual(len(clusters(a)),2)
 def test_explanations_present(self):
  a=[make(1,"万里汇遭客户投诉账户冻结无法提现")]
  enriched,rep=analyze({"items":a})
  self.assertTrue(enriched["items"][0]["sentiment"]["reasons"])
  self.assertTrue(enriched["items"][0]["crisis"]["rationale"])
  self.assertIn("limitations",rep)

if __name__=="__main__":unittest.main(verbosity=2)

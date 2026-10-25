#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from social import extract_records,licensed_import

class SocialConnectorTests(unittest.TestCase):
 def test_empty_provider(self):
  with tempfile.TemporaryDirectory() as d:
   rows,state=licensed_import(Path(d)/"no-file.json")
   self.assertEqual(state,"not_configured");self.assertEqual(rows,[])
 def test_requires_rights(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"data.json"
   p.write_text(json.dumps({"items":[{"company":"worldfirst","platform":"zhihu","title":"万里汇客户反馈","url":"https://www.zhihu.com/question/100"}]}))
   _,state=licensed_import(p)
   self.assertEqual(state,"rejected_missing_rights_confirmation")
 def test_requires_display_permission(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"data.json"
   p.write_text(json.dumps({"rights_confirmed":True,"items":[]}))
   _,state=licensed_import(p)
   self.assertEqual(state,"rejected_no_display_permission")
 def test_import_approved_content_with_actual_metrics(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"data.json"
   p.write_text(json.dumps({"rights_confirmed":True,"permitted_to_display_excerpt":True,
    "items":[{"company":"worldfirst","platform":"zhihu","title":"万里汇使用体验反馈",
              "url":"https://www.zhihu.com/question/123","published_at":"2026-10-20",
              "engagement":{"likes":5,"comments":0},"observed_at":"2026-10-21T08:00:00Z"}]}),encoding="utf-8")
   rows,state=licensed_import(p)
   self.assertEqual(state,"ok");self.assertEqual(len(rows),1)
   self.assertEqual(rows[0]["metrics"]["likes"],5)
   self.assertNotIn("views",rows[0]["metrics"])
 def test_skip_irrelevant_and_insecure(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"data.json"
   p.write_text(json.dumps({"rights_confirmed":True,"permitted_to_display_excerpt":True,
    "items":[{"company":"worldfirst","platform":"zhihu","title":"今天天气","url":"https://zhihu.com/question/123"},
             {"company":"worldfirst","platform":"zhihu","title":"万里汇","url":"http://zhihu.com/question/123"}]}),encoding="utf-8")
   rows,_=licensed_import(p)
   self.assertEqual(rows,[])
 def test_parse_nested_records(self):
  self.assertEqual(extract_records({"data":{"results":[{"title":"a","url":"https://zhihu.com"}]}})[0]["title"],"a")
 def test_unknown_schema_no_false_positive(self):
  self.assertEqual(extract_records({"hello":"world"}),[])
if __name__=="__main__":unittest.main(verbosity=2)

import json
import unittest
from pathlib import Path

FX = Path(__file__).resolve().parents[1]

class EditorialTests(unittest.TestCase):
    def test_editorial_contract(self):
        data=json.loads((FX/"data"/"editorial.json").read_text(encoding="utf-8"))
        self.assertEqual(data["schema_version"],1)
        self.assertTrue(data["items"])
        for id, note in data["items"].items():
            self.assertEqual(len(id),16)
            for key in ["dek","insight","business","watch"]:
                self.assertIsInstance(note[key],str)
                self.assertGreater(len(note[key]),12)
            self.assertNotIn("<script", str(note).lower())
            if note.get("status")=="primary_checked":
                self.assertTrue(all(str(link).startswith("https://") for link in note["evidence"]))
    def test_editorial_coverage_of_initial_news(self):
        news=json.loads((FX/"data"/"articles.json").read_text(encoding="utf-8"))
        editorial=json.loads((FX/"data"/"editorial.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(editorial["items"]),10)
        self.assertTrue(any(a["id"] in editorial["items"] for a in news["articles"]))
    def test_no_teaching_experiment_in_homepage(self):
        html=(FX/"index.html").read_text(encoding="utf-8")
        self.assertIn('id="stream"',html)
        self.assertIn("外汇内参",html)
        self.assertNotIn("机制实验室",html)
        self.assertNotIn("LEARN BY REASONING",html)

if __name__=="__main__":
    unittest.main()

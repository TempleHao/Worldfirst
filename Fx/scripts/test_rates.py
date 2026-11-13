import io
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock
import rates

def ecb_xml():
    days=[f"2026-11-{day:02d}" for day in range(6,14)]
    rows=[]
    for idx,day in enumerate(days):
        rows.append(f"<Cube time='{day}'><Cube currency='USD' rate='{1.10+idx/1000:.4f}'/><Cube currency='CNY' rate='{7.30+idx/100:.4f}'/><Cube currency='JPY' rate='{175+idx:.4f}'/><Cube currency='HKD' rate='8.7'/><Cube currency='GBP' rate='0.84'/></Cube>")
    return ("<Envelope xmlns='urn:x'><Cube>"+"".join(rows)+"</Cube></Envelope>").encode()
class FakeResponse:
    def __init__(self, data):self.body=io.BytesIO(data)
    def __enter__(self):return self
    def __exit__(self,*args):self.body.close()
    def read(self,n):return self.body.read(n)
class RateTests(unittest.TestCase):
    def test_ecb_same_day_cross_and_history(self):
        rows=rates.parse_ecb(ecb_xml())
        instruments={r["pair"]:r for r in rates.ecb_instruments(rows)}
        self.assertAlmostEqual(instruments["USD/CNY"]["value"],float(Decimal("7.37")/Decimal("1.107")),places=5)
        self.assertEqual(instruments["EUR/USD"]["value"],1.107)
        self.assertEqual(instruments["USD/CNY"]["method"],"same_day_cross")
        self.assertEqual(instruments["USD/CNY"]["comparison_date"],"2026-11-08")
        self.assertEqual(len(instruments["USD/CNY"]["points"]),8)
    def test_hkma_daily_close_and_date(self):
        raw=json.dumps({"result":{"records":[{"end_of_day":"2026-11-13","usd":7.8123},{"end_of_day":"2026-11-12","usd":"7.8120"}]}}).encode()
        items=rates.parse_hkma(raw)
        entry=rates.hkma_instrument(items)
        self.assertEqual(entry["pair"],"USD/HKD")
        self.assertEqual(entry["value"],7.8123)
        self.assertEqual(entry["source"],"香港金管局 HKMA")
    def test_invalid_source_must_never_invent_quote(self):
        with self.assertRaises(ValueError):rates.parse_ecb(b"<Envelope><Cube/></Envelope>")
        with self.assertRaises(ValueError):rates.parse_hkma(b'{"result":{"records":[]}}')
        for s in ["0","NaN","Infinity","-4"]:
            with self.assertRaises(ValueError):rates.decimal_rate(s)
    def test_failures_preserve_dated_data_not_attempted_time(self):
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory)/"market.json"
            out.write_text(json.dumps({"last_successful_at":"2026-11-11T00:00:00Z","instruments":[{"pair":"EUR/USD","date":"2026-11-11","value":1.1}]}))
            frozen=rates.dt.datetime(2026,11,14,9,tzinfo=rates.dt.timezone.utc)
            class FrozenDateTime(rates.dt.datetime):
                @classmethod
                def now(cls,tz=None):return frozen
            with mock.patch.object(rates,"OUT",out),mock.patch.object(rates,"fetch",side_effect=OSError("offline")),mock.patch.object(rates.dt,"datetime",FrozenDateTime):
                data=rates.collect()
            self.assertEqual(data["instruments"][0]["date"],"2026-11-11")
            self.assertEqual(data["last_successful_at"],"2026-11-11T00:00:00Z")
            self.assertEqual(sum(s["ok"] for s in data["sources"]),0)
    def test_request_size_limit(self):
        with self.assertRaises(ValueError):
            rates.fetch("https://example.com",lambda *_args,**_kw:FakeResponse(b"A"*(rates.MAX_BYTES+1)))
if __name__=="__main__":unittest.main()

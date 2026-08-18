import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from ledger import balance, overdrawn


class TestLedger(unittest.TestCase):
    def test_balance_sums_amounts(self):
        self.assertEqual(balance([("rent", -900), ("pay", 2500)]), 1600)

    def test_overdrawn(self):
        self.assertTrue(overdrawn([("oops", -1)]))
        self.assertFalse(overdrawn([]))


if __name__ == "__main__":
    unittest.main()

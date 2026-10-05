"""Generation budgets must leave space for long audio input; no model download required."""
import unittest
from asr import output_budget
class Budgets(unittest.TestCase):
    def test_long_prompt_reserves_context_for_generated_text(self):
        self.assertEqual(output_budget(51789,131072),65536)
        self.assertEqual(output_budget(72000,131072),58944)
        self.assertEqual(output_budget(1000,131072,5120),5120)
    def test_input_exhausting_context_fails_before_generation(self):
        with self.assertRaises(ValueError): output_budget(131000,131072)
if __name__=='__main__': unittest.main()

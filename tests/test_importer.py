"""Regression test for option boundaries using mocked pdftotext, no PDF dependency."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('importer', Path(__file__).resolve().parents[1] / 'scripts/extract_questions.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImporterTests(unittest.TestCase):
    def fixture(self):
        return '\n'.join(f'{n}\nQuestion with original\nwrapped text. ' + ('Choose two.\n' if n in (52,73) else '\n') + '\n'.join(f'{label} Original choice {label}\ncontinued text.' for label in ('ABCDE' if n in (52,73) else 'ABCD')) for n in range(1,82))

    def test_four_and_five_options_preserve_boundaries(self):
        with patch.object(module.subprocess, 'check_output', return_value=self.fixture()):
            qs = module.extract(Path('test.pdf'))
        self.assertEqual(len(qs), 81)
        self.assertEqual(qs[0]['prompt'], 'Question with original wrapped text.')
        for n in (52,73):
            self.assertEqual([o['id'] for o in qs[n-1]['options']], list('ABCDE'))
            self.assertEqual(qs[n-1]['options'][3]['text'], 'Original choice D continued text.')
            self.assertEqual(qs[n-1]['options'][4]['text'], 'Original choice E continued text.')
            self.assertEqual(qs[n-1]['selectionCount'], 2)
        self.assertTrue(all(q['correctOptionIds'] == [] and q['verification'] == 'ungraded' for q in qs))

    def test_missing_duplicate_or_reordered_labels_fail_closed(self):
        for wrong in ('C Original choice E', 'F Original choice E', 'A Original choice E'):
            with patch.object(module.subprocess, 'check_output', return_value=self.fixture().replace('E Original choice E', wrong)):
                with self.assertRaises(ValueError):
                    module.extract(Path('test.pdf'))

    def test_missing_question_fails(self):
        with patch.object(module.subprocess, 'check_output', return_value=self.fixture().replace('81\n', '82\n')):
            with self.assertRaises(ValueError):
                module.extract(Path('test.pdf'))

import json, unittest
from pathlib import Path
from uuid import uuid4
from jsonschema import Draft202012Validator, ValidationError, FormatChecker

class Contracts(unittest.TestCase):
    def test_all_schemas_are_valid(self):
        for p in Path('/data/contracts').glob('*.schema.json'):
            Draft202012Validator.check_schema(json.loads(p.read_text()))
        self.assertEqual(len(list(Path('/data/contracts').glob('*.schema.json'))),4)
    def test_locator_contract_cross_language(self):
        schema=json.loads(Path('/data/contracts/stage.schema.json').read_text())['properties']['primitives']['items']['oneOf'][0]['properties']['locator']
        validator=Draft202012Validator(schema,format_checker=FormatChecker())
        validator.validate({'kind':'media','timeline':'container','startMs':0,'endMs':1000})
        validator.validate({'kind':'slide','slide':1})
        for value in [{'kind':'slide','slide':0},{'kind':'media','timeline':'audio','startMs':0,'endMs':1000},{'kind':'media','timeline':'container','startMs':0.5,'endMs':10}]:
            with self.assertRaises(ValidationError): validator.validate(value)

if __name__=='__main__': unittest.main()

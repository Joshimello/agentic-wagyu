"""Native backend comparison on real sources; development-only, no models or memory writes."""

import json, time, importlib.metadata
from pathlib import Path
from docling.datamodel.document import InputDocument
from docling.backend.mspowerpoint_backend import MsPowerpointDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling_parse.pdf_parser import DoclingPdfParser

root = Path("/data")
reports = []
for item in json.loads(Path("/evals/documents.json").read_text())["documents"]:
    started = time.monotonic()
    try:
        path = root / "documents" / item["filename"]
        if item["format"] == "pptx":
            source = InputDocument(
                path_or_stream=path,
                format=InputFormat.PPTX,
                backend=MsPowerpointDocumentBackend,
            )
            doc = source._backend.convert()
            report = {
                "filename": item["filename"],
                "units": len(doc.pages),
                "texts": len(doc.texts),
                "pictures": len(doc.pictures),
                "tables": len(doc.tables),
                "notes": sum(t.content_layer.value == "notes" for t in doc.texts),
            }
            doc.save_as_json(root / "evaluations/docling" / f"{item['filename']}.json")
            source._backend.unload()
        else:
            parser = DoclingPdfParser()
            doc = parser.load(path)
            pages = [doc.get_page(i) for i in range(1, doc.number_of_pages() + 1)]
            report = {
                "filename": item["filename"],
                "units": len(pages),
                "textCells": sum(len(p.textline_cells) for p in pages),
            }
            doc.unload()
        report["elapsedMs"] = round((time.monotonic() - started) * 1000)
    except Exception as error:
        report = {
            "filename": item["filename"],
            "error": str(error),
            "elapsedMs": round((time.monotonic() - started) * 1000),
        }
    reports.append(report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
(root / "evaluations/docling/results.json").write_text(
    json.dumps(
        {
            "versions": {
                name: importlib.metadata.version(name)
                for name in ["docling-slim", "docling-core", "docling-parse"]
            },
            "documents": reports,
        },
        ensure_ascii=False,
        indent=2,
    )
)
if any("error" in report for report in reports):
    raise SystemExit(1)

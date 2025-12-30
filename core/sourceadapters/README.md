Documents (DOCX/PDF/XLSX) Loader

- Type: `documents` (alias: `office`)
- Purpose: Convert DOCX/PDF/XLSX files in a folder into Markdown, CSV (for Excel), or JSON documents consumable by engines.

Config example (in your implementation template `Sources`):

{
  "type": "documents",
  "name": "docs",
  "location": "./artifacts/documents/raw", // folder containing .docx/.pdf
  "recurse": true,
  "format": "md", // or "json" (for DOCX/PDF). For Excel, see config.excelFormat
  "config": { 
    "copyToArtifacts": true,
    "excelFormat": "md" // or "csv". When Excel is encountered, emits one file per sheet in this format.
  },
  "prompt": {
    "base": "These documents are source material for review.",
    "mode": "additive"
  }
}

Notes

- DOCX: Uses `mammoth` + `turndown` when available; otherwise falls back to a built-in extractor via `unzip` to get raw text.
- PDF: Uses `pdf-parse` when available; skipped if the dependency is not installed.
- XLSX: Uses `xlsx` when available. Each sheet becomes a separate output file. Set `config.excelFormat` to `md` (Markdown table with a header) or `csv`.
- New/updated detection: maintains `collector.log` alongside your files and only processes files with a newer mtime.
- Artifacts copy: when `config.copyToArtifacts` is true, writes the converted output to `shared/artifacts/<name>/...` preserving subfolders.

Dependencies (optional but recommended)

Run to enable rich conversion:

    npm install mammoth turndown pdf-parse xlsx

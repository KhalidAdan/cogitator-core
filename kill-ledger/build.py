#!/usr/bin/env python3
"""Assemble Kill Ledger into one self-contained HTML file (dist/kill-ledger.html).

The published page must be a single file, so the sources are concatenated into
template.html's /*DATA*/, /*ENGINE*/ and /*APP*/ placeholders. Each source ends with
an `if (typeof module ...)` export block for Node tests; that tail is stripped.
"""
import pathlib
ROOT = pathlib.Path(__file__).parent
src = lambda n: (ROOT / 'src' / n).read_text(encoding='utf-8')
strip = lambda s: s.split("if (typeof module")[0]
html = src('template.html')
html = html.replace('/*DATA*/', strip(src('data.js')) + '\n' + src('extra_lists.js'))
html = html.replace('/*ENGINE*/', strip(src('engine.js')) + '\n' + src('importer.js'))
html = html.replace('/*APP*/', src('app.js'))
out = ROOT / 'dist' / 'kill-ledger.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'wrote {out} ({len(html):,} bytes)')

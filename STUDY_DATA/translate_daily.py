#!/usr/bin/env python3
"""
Translate real-conversation CSV files: add 6 language columns.
Uses batch translation for speed. Supports checkpoint/resume.
"""

import csv
import sys
import time
import os
from deep_translator import GoogleTranslator

DATA_DIR = os.path.dirname(os.path.abspath(__file__))

ALL_FILES = [
    'real-conversation-시사.csv',
    'real-conversation-여행.csv',
    'real-conversation-일상.csv',
    'real-conversation-학습.csv',
    'real-conversation-회사.csv',
]

LANGUAGES = [
    ('ja', 'japanese'),
    ('zh-CN', 'chinese'),
    ('es', 'spanish'),
    ('vi', 'vietnamese'),
    ('th', 'thai'),
    ('id', 'indonesian'),
]

BATCH_SIZE = 20


def batch_translate(texts, lang_code, retries=3):
    """Translate a batch of texts."""
    for attempt in range(retries):
        try:
            translator = GoogleTranslator(source='ko', target=lang_code)
            results = translator.translate_batch(texts)
            return results
        except Exception as e:
            print(f"  Retry {attempt+1} for {lang_code}: {e}", file=sys.stderr, flush=True)
            time.sleep(2 * (attempt + 1))
    # Fallback: translate one by one
    print(f"  Falling back to one-by-one for {lang_code}", file=sys.stderr, flush=True)
    results = []
    for text in texts:
        for att in range(retries):
            try:
                translator = GoogleTranslator(source='ko', target=lang_code)
                r = translator.translate(text)
                results.append(r if r else '')
                break
            except Exception:
                time.sleep(1)
                if att == retries - 1:
                    results.append('')
    return results


def process_file(filename):
    input_file = os.path.join(DATA_DIR, filename)
    checkpoint_file = input_file + '.checkpoint'

    print(f"\n{'='*60}", flush=True)
    print(f"Processing: {filename}", flush=True)
    print(f"{'='*60}", flush=True)

    # Read CSV
    rows = []
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row in reader:
            rows.append(row)

    header = rows[0]

    # Skip if already translated
    if 'japanese' in header:
        print(f"  Already translated, skipping.", flush=True)
        return

    data_rows = rows[1:]
    total = len(data_rows)
    print(f"  Read {total} data rows", flush=True)

    new_header = header[:3] + ['japanese', 'chinese', 'spanish', 'vietnamese', 'thai', 'indonesian'] + header[3:]

    # Check checkpoint
    all_translations = {}
    if os.path.exists(checkpoint_file):
        with open(checkpoint_file, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            for idx, row in enumerate(reader):
                all_translations[idx] = row
        print(f"  Resuming with {len(all_translations)} cached rows", flush=True)

    # Extract all Korean texts
    korean_texts = [row[0] if len(row) > 0 else '' for row in data_rows]

    # Process in batches per language
    lang_codes = [code for code, _ in LANGUAGES]
    for lang_code, lang_name in LANGUAGES:
        print(f"\n  Translating to {lang_name} ({lang_code})...", flush=True)
        lang_idx = lang_codes.index(lang_code)

        for batch_start in range(0, total, BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, total)

            # Check if this batch already done
            all_done = True
            for i in range(batch_start, batch_end):
                if i not in all_translations:
                    all_translations[i] = [''] * 6
                if not all_translations[i][lang_idx]:
                    all_done = False

            if all_done:
                continue

            batch_texts = korean_texts[batch_start:batch_end]
            results = batch_translate(batch_texts, lang_code)

            for j, result in enumerate(results):
                row_idx = batch_start + j
                if row_idx not in all_translations:
                    all_translations[row_idx] = [''] * 6
                all_translations[row_idx][lang_idx] = result if result else ''

            if batch_end % 100 == 0 or batch_end == total:
                print(f"    {lang_name}: {batch_end}/{total}", flush=True)
                # Save checkpoint every 100 rows
                with open(checkpoint_file, 'w', encoding='utf-8', newline='') as cf:
                    writer = csv.writer(cf)
                    for ci in range(total):
                        if ci in all_translations:
                            writer.writerow(all_translations[ci])

            time.sleep(0.2)

    # Write final output
    print(f"\n  Writing output...", flush=True)
    with open(input_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(new_header)
        for i in range(total):
            row = data_rows[i]
            translations = all_translations.get(i, [''] * 6)
            new_row = row[:3] + translations + row[3:]
            writer.writerow(new_row)

    if os.path.exists(checkpoint_file):
        os.remove(checkpoint_file)

    print(f"  Done! {total} rows written to {filename}", flush=True)


def main():
    if len(sys.argv) > 1:
        targets = sys.argv[1:]
    else:
        targets = ALL_FILES

    for filename in targets:
        process_file(filename)

    print(f"\nAll files done!", flush=True)


if __name__ == '__main__':
    main()

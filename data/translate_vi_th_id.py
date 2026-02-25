#!/usr/bin/env python3
"""
Add Vietnamese, Thai, and Indonesian translations to toeic-700-1300.csv.
Uses Google Translate via deep_translator for batch translation.
Includes progress saving for resumability.
"""

import csv
import json
import os
import time
import sys
from deep_translator import GoogleTranslator

CSV_PATH = "/Users/jiyongpark/development/ReeeeecallStudy/develop/data/toeic-700-1300.csv"
PROGRESS_PATH = "/Users/jiyongpark/development/ReeeeecallStudy/develop/data/.translate_progress.json"
BATCH_SIZE = 30  # Google Translate batch limit

LANGS = [
    ("vi", "vi_meaning", "vi_example"),
    ("th", "th_meaning", "th_example"),
    ("id", "id_meaning", "id_example"),
]

def load_progress():
    if os.path.exists(PROGRESS_PATH):
        with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_progress(progress):
    with open(PROGRESS_PATH, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=None)

def translate_batch_safe(texts, target_lang, max_retries=3):
    """Translate a batch of texts with retry logic."""
    for attempt in range(max_retries):
        try:
            translator = GoogleTranslator(source='en', target=target_lang)
            results = translator.translate_batch(texts)
            return results
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 5 * (attempt + 1)
                print(f"    Error translating to {target_lang}: {e}. Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"    FAILED translating to {target_lang} after {max_retries} attempts: {e}")
                # Fall back to individual translation
                results = []
                for text in texts:
                    try:
                        translator = GoogleTranslator(source='en', target=target_lang)
                        r = translator.translate(text)
                        results.append(r if r else "")
                        time.sleep(0.3)
                    except:
                        results.append("")
                return results

def main():
    # Read CSV
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    print(f"Loaded {len(rows)} rows from CSV")

    # Ensure new columns exist
    new_cols = ["vi_meaning", "vi_example", "th_meaning", "th_example", "id_meaning", "id_example"]
    for col in new_cols:
        if col not in fieldnames:
            fieldnames.append(col)

    # Load progress
    progress = load_progress()
    
    # Extract meanings and examples
    meanings = [row["english"] for row in rows]
    examples = [row["example"] for row in rows]

    total_batches = (len(rows) + BATCH_SIZE - 1) // BATCH_SIZE

    for lang_code, meaning_col, example_col in LANGS:
        lang_key = f"lang_{lang_code}"
        
        if lang_key in progress and progress[lang_key].get("complete"):
            print(f"\n[{lang_code.upper()}] Already complete, loading from cache...")
            cached = progress[lang_key]
            for i in range(len(rows)):
                rows[i][meaning_col] = cached["meanings"].get(str(i), "")
                rows[i][example_col] = cached["examples"].get(str(i), "")
            continue

        print(f"\n[{lang_code.upper()}] Translating...")
        
        if lang_key not in progress:
            progress[lang_key] = {"meanings": {}, "examples": {}, "complete": False}

        cached_meanings = progress[lang_key]["meanings"]
        cached_examples = progress[lang_key]["examples"]
        
        # Find which rows still need translation
        for batch_idx in range(total_batches):
            start = batch_idx * BATCH_SIZE
            end = min(start + BATCH_SIZE, len(rows))
            
            # Check if batch already done
            batch_done = all(str(i) in cached_meanings and str(i) in cached_examples for i in range(start, end))
            if batch_done:
                for i in range(start, end):
                    rows[i][meaning_col] = cached_meanings[str(i)]
                    rows[i][example_col] = cached_examples[str(i)]
                continue

            # Translate meanings for this batch
            batch_meanings = meanings[start:end]
            batch_examples = examples[start:end]
            
            print(f"  Batch {batch_idx+1}/{total_batches} (rows {start+1}-{end})...")
            
            # Translate meanings
            translated_meanings = translate_batch_safe(batch_meanings, lang_code)
            time.sleep(0.5)
            
            # Translate examples
            translated_examples = translate_batch_safe(batch_examples, lang_code)
            time.sleep(0.5)
            
            # Store results
            for i, (tm, te) in enumerate(zip(translated_meanings, translated_examples)):
                idx = start + i
                tm_val = tm if tm else ""
                te_val = te if te else ""
                cached_meanings[str(idx)] = tm_val
                cached_examples[str(idx)] = te_val
                rows[idx][meaning_col] = tm_val
                rows[idx][example_col] = te_val
            
            # Save progress after each batch
            save_progress(progress)
        
        # Mark language as complete
        progress[lang_code] = progress.get(lang_key, {})
        progress[lang_key]["complete"] = True
        save_progress(progress)
        print(f"  [{lang_code.upper()}] Complete!")

    # Write output CSV
    with open(CSV_PATH, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nDone! Written {len(rows)} rows to {CSV_PATH}")
    
    # Verify
    filled = sum(1 for r in rows if r.get("vi_meaning", "").strip() and r.get("th_meaning", "").strip() and r.get("id_meaning", "").strip())
    print(f"Rows with all 3 languages filled: {filled}/{len(rows)}")

    # Clean up progress file
    if os.path.exists(PROGRESS_PATH):
        os.remove(PROGRESS_PATH)
        print("Cleaned up progress file.")

if __name__ == "__main__":
    main()

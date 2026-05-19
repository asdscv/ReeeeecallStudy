#!/usr/bin/env bash
# Generate tiny STUDY_DATA fixtures for CI plan-validation.
# Mirrors the real corpus layout (51 CSVs, three schemas) without needing the
# gitignored full dataset. Each file gets exactly one data row.
set -euo pipefail

OUT="${1:-/tmp/study_data_fixtures}"
mkdir -p "$OUT"

# ─── Schema A — no header, 16 cols (en/ko/ja/zh/es/vi/th/id × word,example) ──
schemaA_row='word,An example sentence.,한글,한글 예문.,日本語,例文.,中文,例句.,palabra,Ejemplo.,tiếng,Ví dụ.,ภาษา,ตัวอย่าง.,kata,Contoh.'
for i in 1 2 3 4 5 6 7 8 9 10; do
  echo "$schemaA_row" > "$OUT/beginner_batch${i}.csv"
  echo "$schemaA_row" > "$OUT/intermediate_batch${i}.csv"
  echo "$schemaA_row" > "$OUT/advanced_batch${i}.csv"
done

# ─── Schema B — with header ──────────────────────────────────────────────────
schemaB_header='english,example,ko_meaning,ko_example,ja_meaning,ja_example,zh_meaning,zh_example,es_meaning,es_example,vi_meaning,vi_example,th_meaning,th_example,id_meaning,id_example'
schemaB_row='hello,"Hello, how are you?",안녕,안녕하세요,こんにちは,お元気ですか,你好,你好,hola,hola,xin chào,xin chào,สวัสดี,สวัสดี,halo,halo'

emit_B() {
  local filename="$1"
  {
    echo "$schemaB_header"
    echo "$schemaB_row"
  } > "$OUT/$filename"
}

emit_B "english-beginner-1000.csv"
emit_B "ielts-5.0-800.csv"
emit_B "ielts-5.5-1000.csv"
emit_B "ielts-6.0-1200.csv"
emit_B "ielts-6.5-1500.csv"
emit_B "ielts-7.0-1500.csv"
emit_B "toefl-60-800.csv"
emit_B "toefl-80-1200.csv"
emit_B "toefl-100-1500.csv"
emit_B "toefl-110-1500.csv"
emit_B "toefl-120-1500.csv"
emit_B "toeic-600-1000.csv"
emit_B "toeic-700-1300.csv"
emit_B "toeic-800-1500.csv"
emit_B "toeic-900-1500.csv"
emit_B "toeic-990-1500.csv"

# ─── Schema C — Korean source, English target ───────────────────────────────
schemaC_header='korean,english,alt,situation,note,category'
schemaC_row='안녕하세요,Hello there.,Hi!,greeting,formal,일상'

emit_C() {
  local filename="$1"
  {
    echo "$schemaC_header"
    echo "$schemaC_row"
  } > "$OUT/$filename"
}

emit_C "real-conversation-시사.csv"
emit_C "real-conversation-여행.csv"
emit_C "real-conversation-일상.csv"
emit_C "real-conversation-학습.csv"
emit_C "real-conversation-회사.csv"

# Quick sanity: should be exactly 51 CSV files
count=$(ls "$OUT"/*.csv | wc -l | tr -d ' ')
echo "Generated $count CSV fixtures in $OUT"
if [ "$count" != "51" ]; then
  echo "ERROR: expected 51 fixtures, got $count" >&2
  exit 1
fi

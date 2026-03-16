#!/usr/bin/env python3
"""
Bulk import cards into ReeeCall Study from JSON or CSV files.

Usage:
  python bulk_import.py data.json --deck-id X --user-id Y --template-id Z
  python bulk_import.py data.csv --deck-id X --user-id Y --template-id Z --mapping "front=front,back=back"

Environment:
  SUPABASE_URL        - Supabase project URL
  SUPABASE_SERVICE_KEY - Supabase service role key (not anon key)
"""

import argparse
import csv
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

BATCH_SIZE = 1000


def get_client():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def load_json(file_path: str) -> list[dict]:
    """Load cards from a JSON export file."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if "cards" not in data:
        print("Error: JSON file must contain a 'cards' array")
        sys.exit(1)

    cards = []
    for item in data["cards"]:
        cards.append(
            {
                "field_values": item.get("field_values", {}),
                "tags": item.get("tags", []),
            }
        )
    return cards


def load_csv(file_path: str, field_mapping: dict[str, str]) -> list[dict]:
    """Load cards from a CSV file with column-to-field mapping."""
    cards = []
    with open(file_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            field_values = {}
            for csv_col, field_key in field_mapping.items():
                if csv_col in row:
                    field_values[field_key] = row[csv_col]

            tags_raw = row.get("태그", row.get("tags", ""))
            tags = [t.strip() for t in tags_raw.split(";") if t.strip()] if tags_raw else []

            cards.append({"field_values": field_values, "tags": tags})
    return cards


def get_next_position(client, deck_id: str) -> int:
    """Get the current next_position for a deck."""
    result = client.table("decks").select("next_position").eq("id", deck_id).single().execute()
    return result.data.get("next_position", 0)


def import_cards(
    client,
    cards: list[dict],
    deck_id: str,
    user_id: str,
    template_id: str,
):
    """Insert cards in batches."""
    position = get_next_position(client, deck_id)
    total = len(cards)
    inserted = 0

    for i in range(0, total, BATCH_SIZE):
        batch = cards[i : i + BATCH_SIZE]
        rows = []
        for card in batch:
            # Skip cards with no field values
            if not any(v.strip() for v in card["field_values"].values() if v):
                continue

            rows.append(
                {
                    "deck_id": deck_id,
                    "user_id": user_id,
                    "template_id": template_id,
                    "field_values": card["field_values"],
                    "tags": card["tags"],
                    "sort_position": position,
                    "srs_status": "new",
                    "ease_factor": 2.5,
                    "interval_days": 0,
                    "repetitions": 0,
                }
            )
            position += 1

        if rows:
            client.table("cards").insert(rows).execute()
            inserted += len(rows)
            print(f"  Inserted {inserted}/{total} cards...")

    # Update deck next_position
    client.table("decks").update({"next_position": position}).eq("id", deck_id).execute()

    return inserted


def parse_mapping(mapping_str: str) -> dict[str, str]:
    """Parse 'csv_col=field_key,csv_col2=field_key2' format."""
    result = {}
    for pair in mapping_str.split(","):
        parts = pair.strip().split("=")
        if len(parts) == 2:
            result[parts[0].strip()] = parts[1].strip()
    return result


def main():
    parser = argparse.ArgumentParser(description="Bulk import cards into ReeeCall Study")
    parser.add_argument("file", help="Path to JSON or CSV file")
    parser.add_argument("--deck-id", required=True, help="Target deck ID")
    parser.add_argument("--user-id", required=True, help="User ID")
    parser.add_argument("--template-id", required=True, help="Card template ID")
    parser.add_argument(
        "--mapping",
        help="CSV column mapping (e.g., 'front=front,back=back')",
    )

    args = parser.parse_args()
    file_path = Path(args.file)

    if not file_path.exists():
        print(f"Error: File not found: {file_path}")
        sys.exit(1)

    client = get_client()

    ext = file_path.suffix.lower()
    if ext == ".json":
        print(f"Loading JSON from {file_path}...")
        cards = load_json(str(file_path))
    elif ext == ".csv":
        if not args.mapping:
            print("Error: --mapping is required for CSV files")
            sys.exit(1)
        field_mapping = parse_mapping(args.mapping)
        print(f"Loading CSV from {file_path} with mapping: {field_mapping}")
        cards = load_csv(str(file_path), field_mapping)
    else:
        print(f"Error: Unsupported file type: {ext}")
        sys.exit(1)

    print(f"Found {len(cards)} cards")

    if not cards:
        print("No cards to import.")
        return

    inserted = import_cards(client, cards, args.deck_id, args.user_id, args.template_id)
    print(f"Done! Imported {inserted} cards.")


if __name__ == "__main__":
    main()

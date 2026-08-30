#!/usr/bin/env bash
# =====================================================================
# YieldShield — load the historical dataset (no Docker)
# Run this from backend/
#
# Requires: Python 3.10+, and a .env file already filled in
# (copy .env.example to .env first and set real values).
#
# Usage:
#   ./scripts/03_load_data.sh /path/to/binalonan_crop_data4.xlsx
# =====================================================================
set -euo pipefail

XLSX_PATH="${1:?Usage: $0 C:/Users/tyron/Desktop/YS_model_system/YieldShield_revised_latest/binalonan_crop_data4.xlsx}"

if [ ! -f ".env" ]; then
    echo "Error: .env not found. Run: cp .env.example .env, then fill it in."
    exit 1
fi

if [ ! -f "$XLSX_PATH" ]; then
    echo "Error: file not found: $XLSX_PATH"
    exit 1
fi

echo "== Installing Python dependencies =="
pip install -r requirements.txt --break-system-packages

echo "== Loading dataset =="
export $(grep -v '^#' .env | xargs)
python3 etl_load.py --xlsx "$XLSX_PATH"

echo
echo "Done. Historical + reference tables are populated."
echo "Re-running this script is safe (upserts, no duplicates)."

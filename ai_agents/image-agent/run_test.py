import sys
sys.stdout.reconfigure(encoding="utf-8")

# run_test.py
#
# Manual integration test for the Image agent — for the AI engineer only.
# Simulates what the backend does: reads a local image from disk, encodes it
# to base64, then calls analyze_product_image() exactly as the backend would.
#
# In production the backend does NOT read from disk — it receives image_base64
# directly from the frontend HTTP request body and passes it straight through:
#
#   [Frontend] --POST {image_base64, media_type}--> [Backend] --> analyze_product_image()
#
# This script replaces the "frontend sends base64" step with a local file read
# so you can test the agent without a running app.
#
# Usage:
#   python run_test.py                        <- uses product.jpg in this folder
#   python run_test.py path/to/product.jpg    <- uses a specific image

import base64
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from image_agent import _decode_image_bytes, _extract_ocr_text, analyze_product_image

# dict[str, str] — map file extensions to media types accepted by EasyOCR / Claude
EXTENSION_TO_MEDIA_TYPE = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Path — default to product.jpg in this folder if no argument is given
image_path = Path(sys.argv[1]) if len(sys.argv) >= 2 else Path(__file__).parent / "product.jpg"

if not image_path.exists():
    print(f"File not found: {image_path}")
    print("Usage: python run_test.py <path-to-image>")
    sys.exit(1)

# str — file extension lowercased for media type lookup
file_extension = image_path.suffix.lower()

# str or None
media_type = EXTENSION_TO_MEDIA_TYPE.get(file_extension)

if media_type is None:
    print(f"Unsupported file type: {file_extension}")
    print(f"Supported types: {', '.join(EXTENSION_TO_MEDIA_TYPE.keys())}")
    sys.exit(1)

# bytes — raw image bytes from disk
image_bytes = image_path.read_bytes()

# str — base64-encoded image (no data URI prefix)
image_b64 = base64.b64encode(image_bytes).decode("utf-8")

print(f"Image:      {image_path.name}")
print(f"Media type: {media_type}")
print(f"Size:       {len(image_bytes) / 1024:.1f} KB")
print()

# -----------------------------------------------------------------------
# Step 1 — EasyOCR (free, runs locally)
# -----------------------------------------------------------------------
print("Step 1 — EasyOCR (free, local)")
print("-" * 40)

# float — wall-clock start time for OCR step
ocr_start_time = time.time()

# bytes — decoded image bytes
raw_image_bytes = _decode_image_bytes(image_b64)

# str — raw text fragments extracted from the image
ocr_text = _extract_ocr_text(raw_image_bytes)

# float — seconds the OCR step took
ocr_duration_seconds = time.time() - ocr_start_time

print(f"Duration:   {ocr_duration_seconds:.1f}s")
print(f"OCR output: {ocr_text if ocr_text else '(nothing detected)'}")
print()

# -----------------------------------------------------------------------
# Step 2 — Claude text API (structures the OCR output into JSON)
# -----------------------------------------------------------------------
print("Step 2 — Claude text API (structures OCR output)")
print("-" * 40)

# float
claude_start_time = time.time()

# ProductAnalysisResult
result = analyze_product_image(image_b64, media_type)

# float
claude_duration_seconds = time.time() - claude_start_time

print(f"Duration:   {claude_duration_seconds:.1f}s")
print()

# -----------------------------------------------------------------------
# Final result
# -----------------------------------------------------------------------
print("=" * 40)
print("RESULT")
print("=" * 40)
print(f"Name:   {result.name}")
print(f"Brand:  {result.brand}")
print(f"Size:   {result.size}")
print(f"Reason: {result.reason}")

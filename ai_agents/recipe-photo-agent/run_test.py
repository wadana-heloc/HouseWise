import sys
sys.stdout.reconfigure(encoding="utf-8")

# run_test.py
#
# Smoke test for the Recipe Photo agent using a real API call.
# Simulates what the backend does: reads a local image from disk, encodes it
# to base64, then calls extract_recipe_from_image() exactly as the backend would.
#
# In production the backend does NOT read from disk — it receives image_base64
# directly from the frontend HTTP request body and passes it straight through:
#
#   [Frontend] --POST {image_base64, media_type}--> [Backend] --> extract_recipe_from_image()
#
# Usage:
#   python run_test.py                         <- uses recipe.jpg in this folder
#   python run_test.py path/to/recipe.jpg      <- uses a specific image

import base64
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from recipe_photo_agent import extract_recipe_from_image

# dict[str, str] — map file extensions to MIME types accepted by Claude Vision
EXTENSION_TO_MEDIA_TYPE = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

# Path — default to recipe.jpg in this folder if no argument is given
image_path = Path(sys.argv[1]) if len(sys.argv) >= 2 else Path(__file__).parent / "recipe.jpg"

if not image_path.exists():
    print(f"File not found: {image_path}")
    print("Usage: python run_test.py <path-to-recipe-image>")
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

# str — base64-encoded image (no data URI prefix — matches what the frontend sends)
image_base64 = base64.b64encode(image_bytes).decode("utf-8")

print(f"Image:      {image_path.name}")
print(f"Media type: {media_type}")
print(f"Size:       {len(image_bytes) / 1024:.1f} KB")
print()

# ── Call the agent ────────────────────────────────────────────────────────────

print("Sending to Claude Haiku Vision...")
print("-" * 60)

# float — wall-clock start time
start_time = time.time()

# dict
result = extract_recipe_from_image(image_base64, media_type)

# float — seconds the call took
duration_seconds = time.time() - start_time

print(f"Duration: {duration_seconds:.1f}s")
print()

# ── Print result ──────────────────────────────────────────────────────────────

print("=" * 60)
print("RESULT")
print("=" * 60)

if result["reason"] is not None and result["name"] is None:
    print(f"Extraction failed or image not a recipe page.")
    print(f"Reason: {result['reason']}")
    sys.exit(0)

print(f"Name        : {result['name']}")
print(f"Description : {result['description']}")
print(f"Prep time   : {result['prep_minutes']} minutes")
print(f"Servings    : {result['servings']}")
print(f"Tags        : {', '.join(result['tags'])}")

if result["reason"]:
    print(f"Note        : {result['reason']}")

print()
print("Ingredients:")
for ingredient in result["ingredients"]:
    print(f"  - {ingredient['quantity']} {ingredient['unit']} {ingredient['name']} [{ingredient['category']}]")

print()
print("Instructions:")
print(result["instructions"])

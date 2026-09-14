"""Export the remote-library router schema without starting external services."""

import argparse
import json
from pathlib import Path

import handler.auth  # noqa: F401
import handler.database  # noqa: F401
from endpoints.romio import router
from fastapi import FastAPI

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
app = FastAPI(title="RomM remote library", version="1")
app.include_router(router, prefix="/api")
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")

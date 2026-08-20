"""The service's own settings, in one JSON file.

WHY A FILE AND NOT THE ENVIRONMENT. Environment variables are read once, at
import, and can only be changed by restarting the process — which is fine for a
deployment and wrong for a demonstration, where the whole point is to be able to
say "let me raise that limit" and have it take effect. A file can be read on
every request and written by the interface that displays it.

The file holds two unrelated kinds of thing on purpose, because both are
"settings the person running this wants to change without editing code":

  * operational limits, which the API enforces;
  * the contact details the landing page prints, which nothing enforces.

NOTHING SECRET GOES IN HERE. The file is served in full to any client that asks
for it, which is what lets the interface show it, and it is checked in so the
defaults are visible without reading this source. If a credential ever needs to
live somewhere, it does not live here.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

# Beside the package by default, overridable so a container can mount it
# somewhere else without the code caring where.
DEFAULT_PATH = Path(__file__).resolve().parents[2] / "config.json"
CONFIG_PATH = Path(os.getenv("QKD_CONFIG", DEFAULT_PATH))


class Limits(BaseModel):
    """What the service refuses to do, and at what point."""

    model_config = {"extra": "forbid"}

    max_concurrent_runs: int = Field(
        default=5,
        ge=1,
        le=64,
        description="Above this, a run is refused with 429 rather than queued: "
        "a caller that receives 202 believes it has started.",
    )
    run_history: int = Field(
        default=20,
        ge=1,
        le=500,
        description="How many finished runs stay retrievable. Not unbounded, "
        "because a run keeps its per-participant views.",
    )
    max_sync_qubits: int = Field(
        default=200,
        ge=1,
        le=5000,
        description="Above this a synchronous run is refused with 413 and must "
        "be started asynchronously.",
    )


class Contact(BaseModel):
    """What the landing page prints in its footer. Display only."""

    model_config = {"extra": "forbid"}

    repository: str = ""
    api_docs: str = ""
    email: str = ""
    github: str = ""
    linkedin: str = ""


class AppConfig(BaseModel):
    model_config = {"extra": "forbid"}

    limits: Limits = Field(default_factory=Limits)
    contact: Contact = Field(default_factory=Contact)


def load() -> AppConfig:
    """Read the file, falling back to the defaults if it is not there.

    A missing file is not an error: a fresh clone should start and work, and the
    defaults are the documented ones. A malformed file *is* an error and is left
    to surface, because silently running on defaults while a file says otherwise
    is how a limit gets quietly ignored.
    """
    if not CONFIG_PATH.exists():
        return AppConfig()
    return AppConfig.model_validate(json.loads(CONFIG_PATH.read_text()))


def save(config: AppConfig) -> None:
    """Write it back, formatted so a human can read the diff."""
    CONFIG_PATH.write_text(json.dumps(config.model_dump(), indent=2) + "\n")


def json_schema() -> dict[str, Any]:
    """The shape of the settings, for a form that cannot drift from it."""
    return AppConfig.model_json_schema()

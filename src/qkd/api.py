"""HTTP and WebSocket layer: the seam between the engine and any interface.

This module transports; it does not compute. Every number it returns comes from
the engine, every choice it offers comes from the registry, and every validation
it performs is the configuration model's. If this file disappeared, the
assignment would still be satisfied — which is the property worth preserving.

DESIGN DECISIONS
================

1. Runs are asynchronous, results are polled or streamed
---------------------------------------------------------
A simulation in density-matrix mode takes seconds to minutes, far longer than a
request should hold a connection open. POSTing a configuration therefore starts
a run and returns an identifier immediately; the caller then either polls the
result or subscribes to the event stream.

2. The engine runs in a thread, not on the event loop
-------------------------------------------------------
It is synchronous and CPU-bound. Executing it inside the loop would block every
other request, including the WebSocket that is supposed to be reporting its
progress. It runs in a worker thread and pushes events across.

3. Events are stored as well as broadcast
-------------------------------------------
A client that connects late, or reconnects after a drop, receives everything
that has already happened and then continues live. A stream that only carried
events from the moment of subscription would make a reload lose the run.

4. State is in memory, deliberately
------------------------------------
Runs live in a dictionary and vanish when the process stops. This is a
simulator, not a service: a database would add operational weight for a
persistence nobody needs, and presets already cover the case of wanting a run
back — they describe how to reproduce it exactly.
"""

from __future__ import annotations

import asyncio
import csv
import io
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from qkd.attacks import AttackNotAllowedError
from qkd.engine import (
    EventKind,
    SimulationEvent,
    SweepAxis,
    linspace,
    stream,
    sweep_stream,
)
from qkd.registry import UnknownPluginError, describe
from qkd.settings import SimulationConfig, json_schema


class RunStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class RunState:
    """Everything known about one launched run.

    `updated` is an asyncio.Event rather than a callback list: subscribers wait
    on it and then read whatever appeared, so any number of them can follow the
    same run without the producer knowing they exist.
    """

    run_id: str
    status: RunStatus = RunStatus.RUNNING
    events: list[dict] = field(default_factory=list)
    result: dict | None = None
    error: str | None = None
    updated: asyncio.Event = field(default_factory=asyncio.Event)

    def append(self, event: SimulationEvent) -> None:
        self.events.append(
            {"kind": event.kind.value, "index": event.index, "payload": event.payload}
        )
        if event.kind is EventKind.DONE:
            self.result = event.payload
        self._wake()

    def finish(self, status: RunStatus, error: str | None = None) -> None:
        self.status = status
        self.error = error
        self._wake()

    def _wake(self) -> None:
        self.updated.set()
        self.updated.clear()

    def summary(self) -> dict:
        return {
            "run_id": self.run_id,
            "status": self.status.value,
            "events": len(self.events),
            "result": self.result,
            "error": self.error,
        }


_RUNS: dict[str, RunState] = {}


class SweepRequest(BaseModel):
    """A parameter sweep, described by three numbers rather than a list.

    Sending the points explicitly would let a client build a list that disagrees
    with what the axis accepts; sending the endpoints keeps the axis in charge.
    """

    config: SimulationConfig
    axis: SweepAxis
    start: float = Field(ge=0.0)
    stop: float = Field(ge=0.0)
    points: int = Field(default=11, ge=2, le=100)


app = FastAPI(
    title="Quantum Crypto Simulator",
    description="BB84 and E91 over configurable channels, with and without an eavesdropper.",
    version="0.1.0",
)

# The interface is served from a different origin during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


@app.get("/plugins", tags=["discovery"])
def plugins() -> dict:
    """What this build can simulate.

    Attacks come with the positions they may be performed from, so an interface
    can offer only the legal combinations instead of letting someone assemble an
    impossible run and discover it when it fails. The threat model reaches the
    user through this endpoint.
    """
    return describe()


@app.get("/schema", tags=["discovery"])
def schema() -> dict:
    """The JSON Schema of a configuration.

    Generated from the models, so a form built from it cannot drift away from
    what the backend accepts.
    """
    return json_schema()


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------


def _launch(state: RunState, produce) -> None:
    """Consume an event generator on a worker thread, pushing into `state`.

    The generator is synchronous and CPU-bound, so it cannot run on the loop.
    Each event is handed back with call_soon_threadsafe: appending touches an
    asyncio.Event, which is not thread-safe on its own.
    """
    loop = asyncio.get_running_loop()

    def work() -> None:
        try:
            for event in produce():
                loop.call_soon_threadsafe(state.append, event)
            loop.call_soon_threadsafe(state.finish, RunStatus.COMPLETED, None)
        except Exception as exc:  # surfaced to the client, not swallowed
            loop.call_soon_threadsafe(state.finish, RunStatus.FAILED, str(exc))

    asyncio.get_running_loop().run_in_executor(None, work)


def _validate_upfront(produce) -> None:
    """Draw the first event so that an impossible run fails on the POST.

    The engine validates the attacker's placement before its first trial, so
    pulling one event is enough to surface a rejection while the client is still
    holding the request — rather than reporting a failed run they have to poll
    for. A configuration that cannot work should not receive a run identifier.
    """
    generator = produce()
    try:
        next(generator)
    finally:
        generator.close()


@app.post("/simulate", status_code=202, tags=["runs"])
async def simulate(config: SimulationConfig) -> dict:
    """Start a simulation and return its identifier.

    Returns 202 rather than 200: the run has been accepted, not completed.
    """
    try:
        _validate_upfront(lambda: stream(config))
    except AttackNotAllowedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except UnknownPluginError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    state = RunState(run_id=str(uuid.uuid4()))
    _RUNS[state.run_id] = state
    _launch(state, lambda: stream(config))
    return {"run_id": state.run_id, "status": state.status.value}


@app.post("/sweep", status_code=202, tags=["runs"])
async def start_sweep(request: SweepRequest) -> dict:
    """Start a parameter sweep and return its identifier.

    Each point is a complete run, so a sweep is the long-running case: the
    identifier and the event stream matter more here than anywhere else.
    """
    values = linspace(request.start, request.stop, request.points)

    def produce():
        return sweep_stream(request.config, request.axis, values)

    try:
        _validate_upfront(produce)
    except AttackNotAllowedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    state = RunState(run_id=str(uuid.uuid4()))
    _RUNS[state.run_id] = state
    _launch(state, produce)
    return {"run_id": state.run_id, "status": state.status.value, "points": len(values)}


def _get(run_id: str) -> RunState:
    state = _RUNS.get(run_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"no run {run_id}")
    return state


@app.get("/runs/{run_id}", tags=["runs"])
def run_status(run_id: str) -> dict:
    """Status and, once finished, the result."""
    return _get(run_id).summary()


@app.get("/runs/{run_id}/events", tags=["runs"])
def run_events(run_id: str, since: int = 0) -> dict:
    """Events recorded so far, optionally only those after an index.

    The polling counterpart of the WebSocket, for clients that would rather not
    hold a socket open — and a way to catch up after a disconnection.
    """
    state = _get(run_id)
    return {"run_id": run_id, "status": state.status.value, "events": state.events[since:]}


@app.get("/runs/{run_id}/export", tags=["runs"])
def export(run_id: str, format: str = "csv") -> Any:
    """The result as CSV or JSON, for the figures and the report.

    CSV because that is what a plotting tool and a spreadsheet both read, and
    because a curve that can only be seen inside the interface is a curve that
    cannot go into a document.
    """
    state = _get(run_id)
    if state.result is None:
        raise HTTPException(status_code=409, detail="run has not finished")

    if format == "json":
        return state.result
    if format != "csv":
        raise HTTPException(status_code=400, detail="format must be csv or json")

    buffer = io.StringIO()
    points = state.result.get("points")
    if points:  # a sweep: one row per point, which is the shape of a curve
        writer = csv.writer(buffer)
        writer.writerow(
            ["value", "qber", "qber_stdev", "qber_rectilinear", "qber_diagonal",
             "chsh", "chsh_stdev", "eavesdropper_knowledge", "accepted"]
        )
        for point in points:
            by_basis = point.get("qber_by_basis") or {}
            writer.writerow([
                point["value"], point["qber"], point["qber_stdev"],
                by_basis.get("rectilinear"), by_basis.get("diagonal"),
                point["chsh"], point["chsh_stdev"],
                point["eavesdropper_knowledge"], point["accepted"],
            ])
    else:  # a single run: one row per trial
        writer = csv.writer(buffer)
        writer.writerow(
            ["trial", "qber", "sifting_ratio", "n_sifted", "chsh", "chsh_sigma",
             "qber_rectilinear", "qber_diagonal", "eavesdropper_knowledge"]
        )
        for index, trial in enumerate(state.result["trials"]):
            by_basis = trial.get("qber_by_basis") or {}
            writer.writerow([
                index, trial["qber"], trial["sifting_ratio"], trial["n_sifted"],
                trial["chsh"], trial["chsh_sigma"],
                by_basis.get("rectilinear"), by_basis.get("diagonal"),
                trial["eavesdropper_knowledge"],
            ])

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="run-{run_id}.csv"'},
    )


# ---------------------------------------------------------------------------
# Realtime
# ---------------------------------------------------------------------------


@app.websocket("/runs/{run_id}/stream")
async def stream_events(websocket: WebSocket, run_id: str) -> None:
    """Forward a run's events, replaying whatever already happened first.

    A client that connects late, or reloads mid-run, is brought up to date and
    then continues live. The socket closes once the run finishes and everything
    has been delivered.
    """
    await websocket.accept()

    state = _RUNS.get(run_id)
    if state is None:
        await websocket.send_json({"kind": "error", "payload": {"detail": f"no run {run_id}"}})
        await websocket.close()
        return

    sent = 0
    try:
        while True:
            while sent < len(state.events):
                await websocket.send_json(state.events[sent])
                sent += 1

            if state.status is not RunStatus.RUNNING:
                if state.status is RunStatus.FAILED:
                    await websocket.send_json(
                        {"kind": "error", "payload": {"detail": state.error}}
                    )
                break

            await state.updated.wait()
    except WebSocketDisconnect:
        return

    await websocket.close()

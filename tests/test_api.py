"""Tests for qkd.api — the HTTP and WebSocket seam.

They check transport, not physics: that a configuration reaches the engine, that
a result comes back, and that an impossible run is refused at the door. The
numbers themselves are verified in the other suites.

Runs are kept small on purpose. These tests exercise the plumbing, and a large
simulation would only make them slow.
"""

import json

import pytest
from fastapi.testclient import TestClient

from qkd.api import app

client = TestClient(app)

SMALL = {"n_qubits": 40, "seed": 20260813}


def _wait(run_id, timeout=120):
    """Poll until the run leaves the running state."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/runs/{run_id}").json()
        if body["status"] != "running":
            return body
        time.sleep(0.05)
    raise AssertionError("run did not finish in time")


class TestDiscovery:
    def test_plugins_lists_what_can_be_simulated(self):
        body = client.get("/plugins").json()
        assert "ideal" in body["channels"]
        assert "amplitude_damping" in body["channels"]

    def test_attacks_come_with_their_valid_positions(self):
        """So an interface can offer only the legal combinations."""
        assert client.get("/plugins").json()["attacks"]["intercept_resend"] == ["channel"]

    def test_the_schema_is_served_for_the_form(self):
        body = client.get("/schema").json()
        assert body["title"] == "SimulationConfig"
        assert "protocol" in body["properties"]

    def test_the_schema_carries_the_closed_choices(self):
        defs = client.get("/schema").json()["$defs"]
        assert set(defs["ProtocolKind"]["enum"]) == {"bb84", "e91"}


class TestSimulate:
    def test_a_run_is_accepted_and_identified(self):
        """202, not 200: accepted rather than completed."""
        response = client.post("/simulate", json=SMALL)
        assert response.status_code == 202
        assert response.json()["status"] == "running"

    def test_an_ideal_run_completes_with_zero_error(self):
        run_id = client.post("/simulate", json=SMALL).json()["run_id"]
        body = _wait(run_id)
        assert body["status"] == "completed"
        assert body["result"]["qber_mean"] == 0.0
        assert body["result"]["accepted"] is True

    def test_an_intercepted_run_is_rejected_by_the_policy(self):
        config = {**SMALL, "n_qubits": 300, "attack": {"kind": "intercept_resend"}}
        body = _wait(client.post("/simulate", json=config).json()["run_id"])
        assert body["result"]["qber_mean"] > 0.1
        assert body["result"]["accepted"] is False

    def test_an_invalid_configuration_is_refused_by_validation(self):
        """Damping without a parameter never reaches the engine."""
        bad = {**SMALL, "channel": {"kind": "amplitude_damping"}}
        assert client.post("/simulate", json=bad).status_code == 422

    def test_an_impossible_placement_is_refused_at_the_door(self):
        """No run identifier is issued for a run that cannot be performed.

        The engine validates before its first trial, so the rejection surfaces
        while the client is still holding the request rather than as a failed
        run they would have to poll for.
        """
        bad = {**SMALL, "attack": {"kind": "intercept_resend", "position": "endpoint"}}
        response = client.post("/simulate", json=bad)
        assert response.status_code == 422
        assert "endpoint" in response.json()["detail"]

    def test_an_unknown_run_is_a_404(self):
        assert client.get("/runs/does-not-exist").status_code == 404


class TestEvents:
    def test_events_are_recorded_in_order(self):
        run_id = client.post("/simulate", json={**SMALL, "trials": 3}).json()["run_id"]
        _wait(run_id)
        kinds = [e["kind"] for e in client.get(f"/runs/{run_id}/events").json()["events"]]
        assert kinds[0] == "started"
        assert kinds[-1] == "done"
        assert kinds.count("trial") == 3

    def test_events_can_be_polled_incrementally(self):
        """The catch-up path for a client that dropped its socket."""
        run_id = client.post("/simulate", json=SMALL).json()["run_id"]
        _wait(run_id)
        everything = client.get(f"/runs/{run_id}/events").json()["events"]
        tail = client.get(f"/runs/{run_id}/events?since=1").json()["events"]
        assert tail == everything[1:]

    def test_a_trial_carries_the_per_participant_views(self):
        """What the node dialogs and the sifting animation replay."""
        run_id = client.post(
            "/simulate", json={**SMALL, "attack": {"kind": "intercept_resend"}}
        ).json()["run_id"]
        _wait(run_id)
        trial = client.get(f"/runs/{run_id}").json()["result"]["trials"][0]

        views = trial["views"]
        assert set(views) >= {"alice", "bob", "eve", "survived_sifting"}
        assert len(views["alice"]["bases"]) == SMALL["n_qubits"]
        assert len(views["survived_sifting"]) == SMALL["n_qubits"]

    def test_the_eavesdropper_knowledge_is_reported(self):
        """The number that makes the trade-off concrete next to the QBER."""
        run_id = client.post(
            "/simulate",
            json={**SMALL, "n_qubits": 400, "attack": {"kind": "intercept_resend"}},
        ).json()["run_id"]
        _wait(run_id)
        trial = client.get(f"/runs/{run_id}").json()["result"]["trials"][0]
        assert 0.3 < trial["eavesdropper_knowledge"] < 0.7

    def test_nobody_listening_means_no_eve_view(self):
        """Absence is reported as absence, not as zero."""
        run_id = client.post("/simulate", json=SMALL).json()["run_id"]
        _wait(run_id)
        trial = client.get(f"/runs/{run_id}").json()["result"]["trials"][0]
        assert "eve" not in trial["views"]
        assert trial["eavesdropper_knowledge"] is None


class TestWebSocket:
    def test_the_stream_replays_and_then_follows(self):
        run_id = client.post("/simulate", json={**SMALL, "trials": 2}).json()["run_id"]
        received = []
        with client.websocket_connect(f"/runs/{run_id}/stream") as ws:
            while True:
                message = ws.receive_json()
                received.append(message)
                if message["kind"] in ("done", "error"):
                    break

        assert received[0]["kind"] == "started"
        assert received[-1]["kind"] == "done"
        assert sum(1 for m in received if m["kind"] == "trial") == 2

    def test_a_late_subscriber_gets_everything(self):
        """Connecting after the run finished still delivers the whole history."""
        run_id = client.post("/simulate", json=SMALL).json()["run_id"]
        _wait(run_id)

        received = []
        with client.websocket_connect(f"/runs/{run_id}/stream") as ws:
            while True:
                message = ws.receive_json()
                received.append(message)
                if message["kind"] in ("done", "error"):
                    break
        assert received[0]["kind"] == "started"

    def test_an_unknown_run_is_reported_on_the_socket(self):
        with client.websocket_connect("/runs/nope/stream") as ws:
            assert ws.receive_json()["kind"] == "error"


class TestSweep:
    def test_a_sweep_returns_one_point_per_value(self):
        request = {
            "config": {**SMALL, "n_qubits": 60},
            "axis": "gamma",
            "start": 0.0,
            "stop": 0.6,
            "points": 4,
        }
        response = client.post("/sweep", json=request)
        assert response.status_code == 202
        assert response.json()["points"] == 4

        body = _wait(response.json()["run_id"])
        assert len(body["result"]["points"]) == 4

    def test_the_damping_curve_grows_and_splits_by_basis(self):
        """The figure the report leads with, delivered over HTTP.

        Both series are present because a pooled error rate would average away
        the asymmetry that identifies the channel.
        """
        request = {
            "config": {**SMALL, "n_qubits": 200},
            "axis": "gamma",
            "start": 0.0,
            "stop": 0.8,
            "points": 3,
        }
        body = _wait(client.post("/sweep", json=request).json()["run_id"])
        points = body["result"]["points"]

        assert points[0]["qber"] < points[-1]["qber"]
        assert points[-1]["qber_by_basis"]["rectilinear"] > points[-1]["qber_by_basis"]["diagonal"]

    def test_the_interception_curve_carries_what_eve_learns(self):
        request = {
            "config": {**SMALL, "n_qubits": 200},
            "axis": "attack_fraction",
            "start": 0.0,
            "stop": 1.0,
            "points": 3,
        }
        body = _wait(client.post("/sweep", json=request).json()["run_id"])
        points = body["result"]["points"]
        assert points[0]["qber"] == 0.0
        assert points[-1]["eavesdropper_knowledge"] > points[0]["eavesdropper_knowledge"]

    def test_a_sweep_needs_at_least_two_points(self):
        request = {"config": SMALL, "axis": "gamma", "start": 0.0, "stop": 0.5, "points": 1}
        assert client.post("/sweep", json=request).status_code == 422


class TestExport:
    def test_a_run_exports_as_csv(self):
        run_id = client.post("/simulate", json={**SMALL, "trials": 2}).json()["run_id"]
        _wait(run_id)
        response = client.get(f"/runs/{run_id}/export?format=csv")

        assert response.status_code == 200
        lines = response.text.strip().splitlines()
        assert lines[0].startswith("trial,qber")
        assert len(lines) == 3  # header plus two trials

    def test_a_sweep_exports_one_row_per_point(self):
        """The shape a plotting tool and a spreadsheet both read."""
        request = {
            "config": {**SMALL, "n_qubits": 60},
            "axis": "gamma",
            "start": 0.0,
            "stop": 0.4,
            "points": 3,
        }
        run_id = client.post("/sweep", json=request).json()["run_id"]
        _wait(run_id)
        lines = client.get(f"/runs/{run_id}/export").text.strip().splitlines()

        assert lines[0].startswith("value,qber")
        assert len(lines) == 4

    def test_json_export_returns_the_raw_result(self):
        run_id = client.post("/simulate", json=SMALL).json()["run_id"]
        _wait(run_id)
        assert "qber_mean" in client.get(f"/runs/{run_id}/export?format=json").json()

    def test_exporting_an_unfinished_run_is_a_conflict(self):
        """A run with no result yet cannot be exported.

        The state is registered directly rather than by launching a long
        simulation and racing it: a test that depends on winning a race against
        a worker thread passes or fails by timing, which is exactly what a test
        must not do.
        """
        from qkd.api import _RUNS, RunState

        state = RunState(run_id="still-running")
        _RUNS[state.run_id] = state
        try:
            assert client.get("/runs/still-running/export").status_code == 409
        finally:
            del _RUNS[state.run_id]

    def test_an_unknown_format_is_refused(self):
        run_id = client.post("/simulate", json=SMALL).json()["run_id"]
        _wait(run_id)
        assert client.get(f"/runs/{run_id}/export?format=xml").status_code == 400


class TestOpenApi:
    def test_the_specification_is_generated(self):
        """Free documentation of the contract, and what a client generator reads."""
        spec = client.get("/openapi.json").json()
        assert "/simulate" in spec["paths"]
        assert "/sweep" in spec["paths"]
        assert "/plugins" in spec["paths"]

    def test_the_specification_is_serialisable(self):
        json.dumps(client.get("/openapi.json").json())

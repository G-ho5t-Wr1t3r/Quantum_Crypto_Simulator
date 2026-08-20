/**
 * The API contract, frozen on 18 August.
 *
 * These types mirror what the backend sends; they are not an interpretation of
 * it. Every field named here exists in `src/qkd/settings.py` (the request side)
 * or in `src/qkd/engine.py` (the response side), and the shape of an event is
 * the envelope defined in `SimulationEvent`.
 *
 * THE ONE CONVENTION THAT MATTERS
 * ================================
 * `null` means "not applicable", never "zero". The Bell parameter is null in
 * BB84 because there is no entangled pair to violate anything, and what an
 * eavesdropper knows is null when nobody is listening. Both are absences, and
 * an interface that drew them as 0 would put a point on a chart where no
 * measurement was ever made.
 *
 * That is why every such field is typed `| null` rather than defaulted, and why
 * `lib/nullable.ts` exists instead of a `?? 0` sprinkled around the components.
 */

// ---------------------------------------------------------------------------
// Configuration — what goes to the backend
// ---------------------------------------------------------------------------

export type ProtocolKind = "bb84" | "e91";
export type ChannelKind = "ideal" | "amplitude_damping";
export type AttackKind = "none" | "intercept_resend";
export type AttackerPosition = "channel" | "endpoint";

/**
 * How the transmission line behaves.
 *
 * `gamma` and `length_km` are two descriptions of the same channel, related by
 * gamma = 1 - exp(-L/L0). Exactly one may be present, and an ideal channel
 * takes neither: the backend rejects any other combination, so a form must
 * enforce the same rule rather than send something it knows will be refused.
 */
export interface ChannelConfig {
  kind: ChannelKind;
  gamma?: number | null;
  length_km?: number | null;
}

/** Whether anyone is listening, and from where. */
export interface AttackConfig {
  kind: AttackKind;
  position?: AttackerPosition;
  /**
   * Share of qubits the attacker touches. Below 1 the induced error falls
   * proportionally — the trade an adversary makes between what they learn and
   * how visible they are.
   */
  fraction?: number;
}

/**
 * The rule that turns numbers into a verdict.
 *
 * Kept separate from the run because it is a policy, not a measurement: the
 * same run can be accepted or rejected depending on the assumptions declared
 * here, and those assumptions have to be visible rather than compiled in.
 */
export interface SecurityPolicy {
  qber_threshold?: number;
  chsh_confidence?: number;
}

export interface SimulationConfig {
  protocol?: ProtocolKind;
  n_qubits?: number;
  trials?: number;
  /** Required by the backend: reproducibility is a property of the run. */
  seed: number;
  channel?: ChannelConfig;
  attack?: AttackConfig;
  security?: SecurityPolicy;
}

export type SweepAxis = "gamma" | "length_km" | "attack_fraction";

/**
 * A sweep, described by its endpoints rather than by a list of points.
 *
 * Sending the values explicitly would let a client build a list that disagrees
 * with what the axis accepts; sending three numbers keeps the axis in charge.
 */
export interface SweepRequest {
  config: SimulationConfig;
  axis: SweepAxis;
  start: number;
  stop: number;
  points?: number;
}

// ---------------------------------------------------------------------------
// Results — what comes back
// ---------------------------------------------------------------------------

/**
 * What one participant recorded, position by position.
 *
 * All the arrays in a `Views` are aligned by index on the transmitted qubits,
 * which is what lets an interface replay preparation, transit and sifting from
 * them. In BB84 a participant records `bases`; in E91 the same slot is
 * `angles`, because the choice being made is an angle and calling it a basis
 * would hide that E91 measures along more directions than two.
 */
export interface ParticipantView {
  /**
   * BB84 only. 0 is the rectilinear (Z) basis, 1 the diagonal (X) one — the
   * same encoding the protocol uses, not a label invented for display.
   *
   * On Eve's view an entry is null where that qubit passed untouched, which is
   * what tells the map which qubits she actually intercepted rather than just
   * how many.
   */
  bases?: (number | null)[];
  /** E91 only, in degrees. The choice being made is an angle, not a basis. */
  angles?: (number | null)[];
  /** Alice's prepared bits, BB84 only. */
  bits?: number[];
  /** What the participant read. Alice has none in BB84: she prepared. */
  outcomes?: number[];
}

export interface Views {
  alice: ParticipantView;
  bob: ParticipantView;
  /**
   * Absent when nobody is listening — the key is missing, not empty.
   *
   * Where present, `bases[i]` is null on a qubit that passed untouched and
   * carries the basis used on one that did not. That per-qubit null is what
   * drives the colouring of the quantum link: it says exactly which qubits Eve
   * touched, which is more than the aggregate error rate can say.
   */
  eve?: ParticipantView;
  /** True where Alice and Bob happened to agree, and the position survived. */
  survived_sifting: boolean[];
}

export interface TrialResult {
  qber: number;
  sifting_ratio: number;
  n_sifted: number;
  /** Null in BB84: no entangled pair, so no Bell parameter. */
  chsh: number | null;
  chsh_sigma: number | null;
  /**
   * Split by basis, under the keys `rectilinear` and `diagonal`.
   *
   * Null as a whole in E91, which does not sift into two bases; null for one
   * key where that basis never came up on a short run. It exists because the
   * asymmetry between the two is the fingerprint of amplitude damping, and an
   * average over both hides exactly the thing worth seeing.
   */
  qber_by_basis: Record<string, number | null> | null;
  /** Null when nobody is listening. */
  eavesdropper_knowledge: number | null;
  /**
   * Present on the first trial only.
   *
   * They are proportional to the qubit count, and an interface animates one run
   * rather than all of them. Reading `trials[i].views` for i > 0 is expected to
   * be null; that is the contract, not a gap in the data.
   */
  views: Views | null;
}

export interface RunResult {
  trials: TrialResult[];
  qber_mean: number;
  qber_stdev: number;
  chsh_mean: number | null;
  chsh_stdev: number | null;
  /** The policy's verdict on this run, with the sentence that explains it. */
  accepted: boolean;
  reason: string;
}

export interface SweepPoint {
  /** Where on the axis this point sits. */
  value: number;
  qber: number;
  qber_stdev: number;
  chsh: number | null;
  chsh_stdev: number | null;
  accepted: boolean;
  /**
   * Kept per point because the split by basis is the reason the damping curve
   * is worth plotting at all: rectilinear and diagonal must stay separate
   * series, or the asymmetry that identifies amplitude damping averages away.
   */
  qber_by_basis: Record<string, number | null> | null;
  eavesdropper_knowledge: number | null;
}

// ---------------------------------------------------------------------------
// Events — the envelope
// ---------------------------------------------------------------------------

/**
 * `error` is not an engine event: the engine emits started/trial/sweep_point/
 * done, and the transport adds `error` when a run failed or does not exist.
 * They arrive on the same socket, so the client has to handle all five.
 */
export type EventKind = "started" | "trial" | "done" | "sweep_point" | "error";

export interface SimulationEvent<P = unknown> {
  kind: EventKind;
  /** Which trial or which sweep point; null for events about the run itself. */
  index: number | null;
  payload: P;
}

export interface StartedPayload {
  protocol?: ProtocolKind;
  /** The kind that was configured, not the object — a label for the run. */
  channel?: ChannelKind;
  attack?: AttackKind;
  trials?: number;
  n_qubits?: number;
  /** These three instead, when the run is a sweep. */
  axis?: SweepAxis;
  values?: number[];
  points?: number;
}

export type TrialEvent = SimulationEvent<TrialResult> & { kind: "trial" };
export type SweepPointEvent = SimulationEvent<SweepPoint> & { kind: "sweep_point" };
export type StartedEvent = SimulationEvent<StartedPayload> & { kind: "started" };
export type DoneEvent = SimulationEvent<RunResult | { axis: SweepAxis; points: SweepPoint[] }> & {
  kind: "done";
};
export type ErrorEvent = SimulationEvent<{ detail: string }> & { kind: "error" };

export type AnyEvent = StartedEvent | TrialEvent | SweepPointEvent | DoneEvent | ErrorEvent;

/** A run is finished once one of these has arrived; nothing follows them. */
export function isTerminal(event: AnyEvent): boolean {
  return event.kind === "done" || event.kind === "error";
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/**
 * `cancelled` is neither of the other two: nothing went wrong, and the result
 * is partial — a sweep stopped halfway keeps the points it reached.
 */
export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export interface RunHandle {
  run_id: string;
  status: RunStatus;
  /** Only on a sweep: how many points were expanded from the endpoints. */
  points?: number;
}

export interface RunSummary {
  run_id: string;
  status: RunStatus;
  /** How many events have been recorded, for catching up via polling. */
  events: number;
  result: RunResult | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface TopologyNode {
  id: string;
  label: string;
  role: string;
  position: string;
  /** True for a node that only exists when the run is configured with one. */
  optional?: boolean;
}

export interface TopologyLink {
  source: string;
  target: string;
  kind: "quantum" | "classical";
  /**
   * Only quantum links are attackable. The classical link is assumed
   * authenticated, and the map has to say so rather than leave it to be
   * inferred: without that assumption the protocol falls to a man in the
   * middle, so it is a stated premise and not an omission.
   */
  attackable: boolean;
}

export interface Topology {
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export interface Plugins {
  channels: string[];
  /** Each attack with the positions it may legally be performed from. */
  attacks: Record<string, string[]>;
  positions: string[];
  topologies: Record<ProtocolKind, Topology>;
}


// ---------------------------------------------------------------------------
// The service's own settings
// ---------------------------------------------------------------------------

/**
 * What the service refuses to do, and at what point.
 *
 * Served rather than compiled in, so the numbers a settings panel shows are the
 * ones actually being enforced — read from the same file at the same moment.
 */
export interface Limits {
  max_concurrent_runs: number;
  run_history: number;
  max_sync_qubits: number;
}

/** What the landing page prints in its footer. Display only, nothing enforced. */
export interface Contact {
  repository: string;
  api_docs: string;
  email: string;
  github: string;
  linkedin: string;
}

export interface AppConfig {
  limits: Limits;
  contact: Contact;
}

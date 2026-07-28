// Artifact Tests — domain types. See specs/artifact-tests.md.

export type TestMode = 'monitor' | 'block';
export type TestTrigger = 'publish' | 'manual' | 'schedule';
// errored = the harness failed (render null, session cap, timeout). NEVER a pass.
export type TestStatus = 'running' | 'passed' | 'failed' | 'errored';
export type TestTier = 'smoke' | 'contract' | 'policy' | 'flow';
export type ResultStatus = 'passed' | 'failed' | 'errored';

// Declarative spec shipped as shareout.tests.json (no server-side user JS).
// contract (read-only T2) + optional fixtures + flows (T3, sandboxed read-only render).
export interface TestSpec {
  contract?: ContractAssertion[];
  fixtures?: Record<string, unknown>;
  flows?: FlowSpec[];
}

// store: "table:<name>" | "json:<key>". Read-only assertions on stored shapes.
export interface ContractAssertion {
  store: string;
  expect: {
    columns?: string[];
    minRows?: number;
    maxRows?: number;
    schema?: Record<string, string>;
  };
}

// Declarative e2e steps, run in a sandboxed read-only render (owner_test session).
export interface FlowSpec {
  name: string;
  steps: FlowStep[];
}
export type FlowStep =
  | { visit: string }
  | { click: string }
  | { fill: [string, string] }
  | { expect: { selector?: string; text?: string; store?: string } };

// One per-assertion outcome. Booleans/messages only — never captured values.
export interface TestResult {
  name: string;
  tier: TestTier;
  status: ResultStatus;
  message?: string;
  duration_ms?: number;
}

export interface ArtifactTestConfig {
  artifact_id: string;
  enabled: boolean;
  mode: TestMode;
  spec: TestSpec | null;
  baseline_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestRun {
  id: string;
  artifact_id: string;
  version_id: string | null;
  trigger: TestTrigger;
  mode: TestMode;
  status: TestStatus;
  passed_count: number;
  failed_count: number;
  errored_count: number;
  results: TestResult[];
  triggered_by: string | null;
  started_at: string;
  finished_at: string | null;
}

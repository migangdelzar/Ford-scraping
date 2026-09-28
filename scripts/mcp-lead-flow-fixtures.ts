import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export interface LeadFlowExpectation {
  handoff: 'required' | 'forbidden';
  consent: 'not_required' | 'required' | 'must_respect_decline';
  resolutionAttemptsMax: number;
  payloadFields: string[];
  finalHandoff: 'succeeded' | 'not_called';
}

export interface LeadFlowFixture {
  id: string;
  tags: string[];
  userTurns: string[];
  expected: LeadFlowExpectation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown, allowEmpty: boolean): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(isNonEmptyString)
  );
}

export function validateLeadFlowFixtures(value: unknown): LeadFlowFixture[] {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Lead flow fixture version must be 1');
  }
  if (!Array.isArray(value.flows) || value.flows.length !== 10) {
    throw new Error('Lead flow fixture must contain exactly ten flows');
  }

  const ids = new Set<string>();
  for (const [index, flow] of value.flows.entries()) {
    const label = `flows[${index}]`;
    if (!isRecord(flow) || !isNonEmptyString(flow.id)) {
      throw new Error(`${label}.id must be a non-empty string`);
    }
    if (ids.has(flow.id)) {
      throw new Error(`Duplicate lead flow id: ${flow.id}`);
    }
    ids.add(flow.id);
    if (!isStringArray(flow.tags, false)) {
      throw new Error(`${label}.tags must be a non-empty string array`);
    }
    if (!isStringArray(flow.userTurns, false)) {
      throw new Error(`${label}.userTurns must be a non-empty string array`);
    }

    const expected = flow.expected;
    if (!isRecord(expected)) {
      throw new Error(`${label}.expected must be an object`);
    }
    if (expected.handoff !== 'required' && expected.handoff !== 'forbidden') {
      throw new Error(`${label}.expected.handoff is invalid`);
    }
    if (
      expected.consent !== 'not_required' &&
      expected.consent !== 'required' &&
      expected.consent !== 'must_respect_decline'
    ) {
      throw new Error(`${label}.expected.consent is invalid`);
    }
    if (
      !Number.isSafeInteger(expected.resolutionAttemptsMax) ||
      (expected.resolutionAttemptsMax as number) < 0
    ) {
      throw new Error(`${label}.expected.resolutionAttemptsMax is invalid`);
    }
    if (!isStringArray(expected.payloadFields, true)) {
      throw new Error(`${label}.expected.payloadFields must be a string array`);
    }
    if (
      expected.finalHandoff !== 'succeeded' &&
      expected.finalHandoff !== 'not_called'
    ) {
      throw new Error(`${label}.expected.finalHandoff is invalid`);
    }
  }

  return value.flows as LeadFlowFixture[];
}

export function loadLeadFlowFixtures(path?: string): LeadFlowFixture[] {
  const fixturePath =
    path ??
    fileURLToPath(
      new URL('../evals/multistep-leads/flows.json', import.meta.url),
    );
  return validateLeadFlowFixtures(
    JSON.parse(readFileSync(fixturePath, 'utf8')),
  );
}

export function selectLeadFlowFixtures(
  fixtures: LeadFlowFixture[],
  start: number,
  flows: number,
): LeadFlowFixture[] {
  if (!Number.isSafeInteger(start) || start < 0 || start >= fixtures.length) {
    throw new Error('--start must be a valid zero-based flow index');
  }
  if (
    !Number.isSafeInteger(flows) ||
    flows < 1 ||
    flows > fixtures.length - start
  ) {
    throw new Error(
      '--flows must be a positive count within the fixture range',
    );
  }
  return fixtures.slice(start, start + flows);
}

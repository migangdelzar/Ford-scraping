import {describe, expect, it} from 'vitest';
import {
  loadLeadFlowFixtures,
  selectLeadFlowFixtures,
  validateLeadFlowFixtures,
} from '../../scripts/mcp-lead-flow-fixtures.js';

const validFlow = {
  id: 'explicit-context',
  tags: ['explicit_request'],
  userTurns: ['Quiero hablar con un especialista sobre la Ranger.'],
  expected: {
    handoff: 'required',
    consent: 'not_required',
    resolutionAttemptsMax: 0,
    payloadFields: ['reason', 'vehicle'],
    finalHandoff: 'succeeded',
  },
};

function validDocument(): unknown {
  return {
    version: 1,
    flows: Array.from({length: 10}, (_, index) => ({
      ...validFlow,
      id: `flow-${index + 1}`,
      expected: {...validFlow.expected},
    })),
  };
}

describe('lead flow fixtures', () => {
  it('repeats the known family-travel need in the first final specialist request', () => {
    const first = loadLeadFlowFixtures()[0];

    expect(first.userTurns.at(-1)).toMatch(/especialista/i);
    expect(first.userTurns.at(-1)).toContain('viajar con mi familia');
  });

  it('selects only the first fixture for start zero and one flow', () => {
    const fixtures = loadLeadFlowFixtures();

    expect(selectLeadFlowFixtures(fixtures, 0, 1).map(flow => flow.id)).toEqual(
      [fixtures[0].id],
    );
  });

  it('selects a bounded range in fixture order', () => {
    const fixtures = loadLeadFlowFixtures();

    expect(selectLeadFlowFixtures(fixtures, 7, 2)).toEqual(
      fixtures.slice(7, 9),
    );
  });

  it.each([
    [-1, 1],
    [0, 0],
    [10, 1],
    [9, 2],
    [0.5, 1],
  ])('rejects invalid selection start=%s flows=%s', (start, flows) => {
    expect(() =>
      selectLeadFlowFixtures(loadLeadFlowFixtures(), start, flows),
    ).toThrow();
  });

  it('loads the ten scripted cases with unique IDs and non-empty user turns', () => {
    const flows = loadLeadFlowFixtures();

    expect(flows).toHaveLength(10);
    expect(new Set(flows.map(flow => flow.id)).size).toBe(10);
    for (const flow of flows) {
      expect(flow.userTurns.length).toBeGreaterThan(0);
      expect(flow.userTurns.every(turn => turn.trim().length > 0)).toBe(true);
    }
  });

  it('anchors uncertain and resolved cases to named offer records and facts', () => {
    const flows = new Map(loadLeadFlowFixtures().map(flow => [flow.id, flow]));
    const conflict = flows.get('conflicting-offer-terms');
    const validity = flows.get('unavailable-offer-validity');
    const resolved = flows.get('resolved-offer-data');

    expect(conflict?.userTurns[0]).toContain(
      'EXPEDITION Active - 60-month financing',
    );
    expect(conflict?.userTurns[0]).toMatch(/24 meses.*60 meses/);
    expect(validity?.userTurns[0]).toContain(
      'EXPEDITION Active - 60-month financing',
    );
    expect(validity?.userTurns[0]).toMatch(/vigencia.*sin confirmar/i);
    expect(resolved?.userTurns[0]).toContain(
      'Territory 12 meses sin intereses',
    );
    expect(resolved?.userTurns[0]).toContain('2026-10-31');
  });

  it('rejects a count other than ten', () => {
    const document = validDocument() as {version: number; flows: unknown[]};
    document.flows.pop();
    expect(() => validateLeadFlowFixtures(document)).toThrow(/ten/i);
  });

  it('rejects duplicate IDs', () => {
    const document = validDocument() as {
      version: number;
      flows: {id: string}[];
    };
    document.flows[1].id = document.flows[0].id;
    expect(() => validateLeadFlowFixtures(document)).toThrow(/id/i);
  });

  it('rejects empty scripted user turns', () => {
    const document = validDocument() as {
      version: number;
      flows: {userTurns: string[]}[];
    };
    document.flows[0].userTurns = ['  '];
    expect(() => validateLeadFlowFixtures(document)).toThrow(/userTurns/i);
  });

  it.each([
    ['handoff', 'maybe'],
    ['consent', 'maybe'],
    ['finalHandoff', 'maybe'],
  ])('rejects an invalid %s enum', (field, value) => {
    const document = validDocument() as {
      version: number;
      flows: {expected: Record<string, unknown>}[];
    };
    document.flows[0].expected[field] = value;
    expect(() => validateLeadFlowFixtures(document)).toThrow(field);
  });

  it('rejects a missing consent expectation', () => {
    const document = validDocument() as {
      version: number;
      flows: {expected: Record<string, unknown>}[];
    };
    delete document.flows[0].expected.consent;
    expect(() => validateLeadFlowFixtures(document)).toThrow(/consent/);
  });

  it('rejects missing required fields and malformed arrays', () => {
    const document = validDocument() as {
      version: number;
      flows: {tags: unknown; expected: Record<string, unknown>}[];
    };
    document.flows[0].tags = 'explicit_request';
    expect(() => validateLeadFlowFixtures(document)).toThrow(/tags/);

    document.flows[0].tags = ['explicit_request'];
    delete document.flows[0].expected.payloadFields;
    expect(() => validateLeadFlowFixtures(document)).toThrow(/payloadFields/);
  });

  it('rejects an invalid version or resolution limit', () => {
    const document = validDocument() as {
      version: number;
      flows: {expected: Record<string, unknown>}[];
    };
    document.version = 2;
    expect(() => validateLeadFlowFixtures(document)).toThrow(/version/);

    document.version = 1;
    document.flows[0].expected.resolutionAttemptsMax = -1;
    expect(() => validateLeadFlowFixtures(document)).toThrow(
      /resolutionAttemptsMax/,
    );
  });
});

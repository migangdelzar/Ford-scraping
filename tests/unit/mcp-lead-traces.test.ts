import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  appendLeadFlowTrace,
  referenceForLeadFlowFixture,
  createLeadFlowTrace,
  validateLeadFlowTrace,
  type LeadFlowTrace,
} from '../../scripts/mcp-lead-traces.js';
import {loadLeadFlowFixtures} from '../../scripts/mcp-lead-flow-fixtures.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.map(path => rm(path, {recursive: true, force: true})),
  );
  tempDirs.length = 0;
});

function trace(): LeadFlowTrace {
  const messages = [
    {role: 'system', content: 'Local simulation.'},
    {role: 'user', content: 'Busca una Ranger.'},
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {function: {name: 'search_vehicles', arguments: {query: 'Ranger'}}},
      ],
    },
    {
      role: 'tool',
      tool_name: 'search_vehicles',
      content: '{"error":"unavailable"}',
    },
    {role: 'assistant', content: 'No pude consultar las opciones.'},
    {role: 'user', content: 'Quiero hablar con un especialista.'},
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          function: {
            name: 'handoff_to_specialist',
            arguments: {reason: 'consulta'},
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_name: 'handoff_to_specialist',
      content: '{"status":"simulated_failure"}',
    },
    {role: 'assistant', content: 'No pude completar la simulación.'},
  ];
  return {
    flowId: 'example',
    fixtureVersion: 1,
    model: 'local-model',
    messages,
    turns: [
      {
        userTurnIndex: 0,
        userMessage: 'Busca una Ranger.',
        assistantAnswers: ['No pude consultar las opciones.'],
      },
      {
        userTurnIndex: 1,
        userMessage: 'Quiero hablar con un especialista.',
        assistantAnswers: ['No pude completar la simulación.'],
      },
    ],
    mcpCalls: [
      {
        userTurnIndex: 0,
        requestEventIndex: 1,
        eventIndex: 2,
        name: 'search_vehicles',
        arguments: {query: 'Ranger'},
        succeeded: false,
      },
    ],
    handoffCalls: [
      {
        userTurnIndex: 1,
        requestEventIndex: 4,
        eventIndex: 5,
        arguments: {reason: 'consulta'},
        status: 'simulated_failure',
      },
    ],
    deterministicScore: {passed: false, failures: ['missed_required_handoff']},
    ragasInput: {
      reference: 'Debe intentar el traspaso simulado.',
      expectedToolNames: ['handoff_to_specialist'],
      expectedHandoff: 'required',
      messages,
    },
    complete: true,
    errors: [
      'search_vehicles:unavailable',
      'handoff_to_specialist:simulated_failure',
    ],
    elapsedMs: 15,
    promptTokens: 42,
    generatedTokens: 12,
  };
}

describe('lead flow traces', () => {
  it('describes a forbidden handoff without claiming an explicit request', () => {
    const fixture = loadLeadFlowFixtures().find(
      flow => flow.id === 'routine-specification',
    );
    if (!fixture) throw new Error('Missing routine fixture');
    const reference = referenceForLeadFlowFixture(fixture);
    expect(reference).toContain('No realizar un traspaso simulado.');
    expect(reference).not.toContain('solicitud explícita');
  });

  it('preserves each scripted turn, tool result, failed mock action, and expected handoff reference', () => {
    const input = trace();
    const actual = createLeadFlowTrace(input);

    expect(actual.turns).toEqual(input.turns);
    expect(actual.messages).toEqual(input.messages);
    expect(actual.mcpCalls).toEqual(input.mcpCalls);
    expect(actual.handoffCalls).toEqual(input.handoffCalls);
    expect(actual.ragasInput.expectedToolNames).toEqual([
      'handoff_to_specialist',
    ]);
  });

  it('accepts a forbidden handoff reference without observed MCP names', () => {
    const input = trace();
    input.ragasInput.expectedHandoff = 'forbidden';
    input.ragasInput.expectedToolNames = [];
    expect(validateLeadFlowTrace(input).ragasInput.expectedToolNames).toEqual(
      [],
    );
  });

  it('accepts a partial transcript and retains a turn with no answer', () => {
    const input = trace();
    input.messages = input.messages.slice(0, 2);
    input.ragasInput.messages = input.messages;
    input.turns = [
      {
        userTurnIndex: 0,
        userMessage: 'Busca una Ranger.',
        assistantAnswers: [],
      },
    ];
    input.complete = false;
    input.errors = ['ollama:unavailable'];
    input.deterministicScore = {
      passed: false,
      failures: ['incomplete_flow', 'evaluation_error'],
    };
    expect(validateLeadFlowTrace(input).turns).toHaveLength(1);
  });

  it('allows a required handoff whose fixture expects no final successful handoff', () => {
    const input = trace();
    input.ragasInput.expectedToolNames = [];
    expect(validateLeadFlowTrace(input).ragasInput.expectedToolNames).toEqual(
      [],
    );
  });

  it.each([
    [
      'messages',
      (input: LeadFlowTrace) => {
        input.messages = [];
      },
      /messages/,
    ],
    [
      'turns',
      (input: LeadFlowTrace) => {
        input.turns = [];
      },
      /turns/,
    ],
    [
      'reference',
      (input: LeadFlowTrace) => {
        input.ragasInput.reference = '';
      },
      /reference/,
    ],
    [
      'score',
      (input: LeadFlowTrace) => {
        input.deterministicScore = {
          passed: true,
        } as LeadFlowTrace['deterministicScore'];
      },
      /deterministicScore/,
    ],
    [
      'fixture version',
      (input: LeadFlowTrace) => {
        input.fixtureVersion = 2 as 1;
      },
      /fixtureVersion/,
    ],
  ] as const)('rejects a missing or invalid %s', (_label, change, error) => {
    const input = trace();
    change(input);
    expect(() => validateLeadFlowTrace(input)).toThrow(error);
  });

  it('rejects a turn assigned to the wrong transcript user message', () => {
    const input = trace();
    input.turns[1].userMessage = 'Different message';
    expect(() => validateLeadFlowTrace(input)).toThrow(/turns/);
  });

  it('rejects a partial run reported as passing or without errors', () => {
    const input = trace();
    input.complete = false;
    input.deterministicScore = {passed: true, failures: []};
    expect(() => validateLeadFlowTrace(input)).toThrow(
      /incomplete|deterministicScore/,
    );
    input.deterministicScore = {passed: false, failures: ['incomplete_flow']};
    input.errors = [];
    expect(() => validateLeadFlowTrace(input)).toThrow(/errors/);
  });

  it('rejects a completed flow with no assistant answer for a scripted turn', () => {
    const input = trace();
    input.messages = [
      {role: 'system', content: 'Local simulation.'},
      {role: 'user', content: '¿Qué vehículos hay?'},
      {role: 'assistant', content: '  '},
    ];
    input.ragasInput.messages = input.messages;
    input.turns = [
      {
        userTurnIndex: 0,
        userMessage: '¿Qué vehículos hay?',
        assistantAnswers: [],
      },
    ];
    input.deterministicScore = {passed: true, failures: []};
    input.errors = [];
    expect(() => validateLeadFlowTrace(input)).toThrow(/assistant answer/);
  });

  it('rejects a completed flow whose final assistant answer is empty after a tool call', () => {
    const input = trace();
    input.messages = [
      {role: 'user', content: '¿Qué vehículos hay?'},
      {
        role: 'assistant',
        content: 'Voy a revisar.',
        tool_calls: [{function: {name: 'search_vehicles'}}],
      },
      {role: 'tool', tool_name: 'search_vehicles', content: '{}'},
      {role: 'assistant', content: ''},
    ];
    input.ragasInput.messages = input.messages;
    input.turns = [
      {
        userTurnIndex: 0,
        userMessage: '¿Qué vehículos hay?',
        assistantAnswers: ['Voy a revisar.'],
      },
    ];
    input.deterministicScore = {passed: true, failures: []};
    input.errors = [];
    expect(() => validateLeadFlowTrace(input)).toThrow(
      /final assistant answer/,
    );
  });

  it('appends one valid JSONL row and creates nested directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lead-trace-'));
    tempDirs.push(dir);
    const path = join(dir, 'nested', 'run.jsonl');
    const input = trace();
    await appendLeadFlowTrace(path, input);
    const rows = (await readFile(path, 'utf8')).trim().split('\n');
    expect(rows).toHaveLength(1);
    expect(validateLeadFlowTrace(JSON.parse(rows[0]))).toEqual(input);
  });
});

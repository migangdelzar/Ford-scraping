import {describe, expect, it} from 'vitest';
import {
  handoffTool,
  simulateLeadHandoff,
} from '../../scripts/mcp-lead-handoff-tool.js';

describe('local handoff tool', () => {
  it('rejects unknown properties instead of returning simulated success', () => {
    const attempt = simulateLeadHandoff('explicit-context', 1, {
      reason: 'Solicita especialista',
      customerName: 'Inventado',
    });

    expect(attempt.status).toBe('simulated_failure');
    expect(attempt.result.status).toBe('simulated_failure');
  });

  it('advertises optional string fields without accepting null', () => {
    expect(
      handoffTool.function.parameters.properties.unresolvedQuestion.type,
    ).toBe('string');
    const attempt = simulateLeadHandoff('explicit-context', 1, {
      reason: 'Solicita especialista',
      vehicle: 'Ranger',
    });

    expect(attempt).toEqual({
      status: 'simulated_success',
      arguments: {reason: 'Solicita especialista', vehicle: 'Ranger'},
      result: {
        status: 'simulated_success',
        reference: 'SIM-explicit-context-1',
      },
    });
  });

  it('rejects null optional arguments as simulated failure', () => {
    const attempt = simulateLeadHandoff('explicit-context', 1, {
      reason: 'Solicita especialista',
      vehicle: 'Ranger',
      unresolvedQuestion: null,
    });

    expect(attempt.status).toBe('simulated_failure');
    expect(attempt.result.status).toBe('simulated_failure');
  });
});

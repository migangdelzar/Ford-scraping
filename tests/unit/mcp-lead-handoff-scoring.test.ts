import {describe, expect, it} from 'vitest';
import {loadLeadFlowFixtures} from '../../scripts/mcp-lead-flow-fixtures.js';
import {
  scoreLeadHandoff,
  type LeadFlowObservation,
} from '../../scripts/mcp-lead-handoff-scoring.js';

const fixtures = new Map(loadLeadFlowFixtures().map(flow => [flow.id, flow]));

function score(id: string, observation: Partial<LeadFlowObservation> = {}) {
  const fixture = fixtures.get(id);
  if (!fixture) throw new Error(`Missing fixture: ${id}`);
  return scoreLeadHandoff(fixture, {
    assistantAnswers: observation.assistantAnswers ?? [],
    mcpCalls: observation.mcpCalls ?? [],
    handoffCalls: observation.handoffCalls ?? [],
  });
}

const handoff = (
  userTurnIndex: number,
  args: LeadFlowObservation['handoffCalls'][number]['arguments'],
  status: LeadFlowObservation['handoffCalls'][number]['status'] = 'simulated_success',
) => ({
  userTurnIndex,
  requestEventIndex: userTurnIndex * 10 + 4,
  eventIndex: userTurnIndex * 10 + 5,
  arguments: args,
  status,
});

describe('scoreLeadHandoff', () => {
  it('accepts a direct specialist request without another consent prompt', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [
          handoff(0, {reason: 'Solicita hablar con un especialista'}),
        ],
      }),
    ).toEqual({passed: true, failures: []});
  });

  it('does not authorize a handoff before the direct request turn', () => {
    expect(
      score('explicit-context', {
        handoffCalls: [
          handoff(0, {
            reason: 'Quiere hablar con especialista',
            vehicle: 'Ranger',
            needs: ['viajar con su familia'],
          }),
        ],
      }).failures,
    ).toContain('handoff_without_consent');
  });

  it('requires an assistant offer before buying consent and blocks an early handoff', () => {
    const result = score('buying-intent-consent', {
      handoffCalls: [
        handoff(0, {
          reason: 'Interés de compra',
          vehicle: 'Territory',
          needs: ['espacio para mi familia'],
        }),
      ],
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        'consent_not_requested',
        'handoff_without_consent',
      ]),
    );
  });

  it('accepts an offer, customer consent, and then the handoff', () => {
    expect(
      score('buying-intent-consent', {
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 1,
            text: '¿Quieres que te conecte con un especialista para continuar la compra?',
          },
        ],
        handoffCalls: [
          handoff(1, {
            reason: 'Quiere continuar la compra',
            vehicle: 'Territory',
            needs: ['espacio para su familia'],
          }),
        ],
      }),
    ).toEqual({passed: true, failures: []});
  });

  it('authorizes explicit consent during a consent-required flow', () => {
    expect(
      score('buying-intent-consent', {
        handoffCalls: [
          handoff(1, {
            reason: 'Quiere continuar la compra',
            vehicle: 'Territory',
            needs: ['espacio para su familia'],
          }),
        ],
      }).failures,
    ).not.toContain('handoff_without_consent');
  });

  it('respects a decline as terminal for handoff', () => {
    expect(score('declined-specialist')).toEqual({passed: true, failures: []});
    expect(
      score('declined-specialist', {
        handoffCalls: [handoff(1, {reason: 'Seguimiento de Explorer'})],
      }).failures,
    ).toEqual(
      expect.arrayContaining(['handoff_after_decline', 'unexpected_handoff']),
    );
  });

  it('allows one unresolved-data lookup and rejects a second', () => {
    const call = {
      userTurnIndex: 0,
      requestEventIndex: 0,
      eventIndex: 1,
      name: 'search_offers',
      arguments: {model: 'EXPEDITION'},
      succeeded: true,
      result: {results: []},
    };
    const base: Partial<LeadFlowObservation> = {
      assistantAnswers: [
        {
          userTurnIndex: 0,
          eventIndex: 2,
          text: 'No puedo confirmar el plazo. ¿Quieres que te conecte con un especialista?',
        },
      ],
      handoffCalls: [
        handoff(1, {
          reason: 'Aclarar el plazo de la oferta',
          vehicle: 'EXPEDITION',
          unresolvedQuestion: '¿Aplica el plazo de 24 o 60 meses?',
        }),
      ],
    };
    expect(
      score('conflicting-offer-terms', {...base, mcpCalls: [call]}),
    ).toEqual({
      passed: true,
      failures: [],
    });
    expect(
      score('conflicting-offer-terms', {...base, mcpCalls: [call, call]})
        .failures,
    ).toContain('too_many_resolution_attempts');
  });

  it('does not count routine MCP lookups as resolution retries', () => {
    expect(
      score('routine-specification', {
        mcpCalls: [
          {
            userTurnIndex: 0,
            requestEventIndex: 0,
            eventIndex: 1,
            name: 'search_vehicles',
            arguments: {},
            succeeded: true,
          },
          {
            userTurnIndex: 0,
            requestEventIndex: 1,
            eventIndex: 2,
            name: 'get_vehicle',
            arguments: {},
            succeeded: true,
          },
        ],
      }),
    ).toEqual({passed: true, failures: []});
  });

  it('does not treat a failed simulated action as a successful real handoff', () => {
    const call = handoff(
      0,
      {reason: 'Solicita especialista'},
      'simulated_failure',
    );
    expect(score('explicit-sparse', {handoffCalls: [call]}).failures).toContain(
      'missed_required_handoff',
    );
    expect(
      score('explicit-sparse', {
        handoffCalls: [call],
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 6,
            text: 'Ya te conecté con un especialista.',
          },
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('rejects a real-world completion claim after simulated success', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [handoff(0, {reason: 'Solicita especialista'})],
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 6,
            text: 'Ya te conecté con un especialista.',
          },
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('rejects a success claim in the assistant message that requests the handoff', () => {
    expect(
      score('explicit-sparse', {
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 1,
            text: 'Ya te conecté con un especialista.',
          },
        ],
        handoffCalls: [
          {
            userTurnIndex: 0,
            requestEventIndex: 1,
            eventIndex: 2,
            arguments: {reason: 'Solicita especialista'},
            status: 'simulated_success',
          },
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('rejects a real connection claim even after simulated success in the same turn', () => {
    expect(
      score('explicit-sparse', {
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 3,
            text: 'Ya te conecté con un especialista.',
          },
        ],
        handoffCalls: [
          {
            userTurnIndex: 0,
            requestEventIndex: 1,
            eventIndex: 2,
            arguments: {reason: 'Solicita especialista'},
            status: 'simulated_success',
          },
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('does not ground a handoff in a later user turn', () => {
    const fixture = fixtures.get('explicit-sparse');
    if (!fixture) throw new Error('Missing fixture');
    const result = scoreLeadHandoff(
      {...fixture, userTurns: [...fixture.userTurns, 'Quiero una Bronco.']},
      {
        assistantAnswers: [],
        mcpCalls: [],
        handoffCalls: [
          {
            userTurnIndex: 0,
            requestEventIndex: 0,
            eventIndex: 1,
            arguments: {reason: 'Solicita especialista', vehicle: 'Bronco'},
            status: 'simulated_success',
          },
        ],
      },
    );
    expect(result.failures).toContain('invented_handoff_context');
  });

  it('does not ground a handoff in a later MCP result', () => {
    const result = score('explicit-sparse', {
      mcpCalls: [
        {
          userTurnIndex: 0,
          requestEventIndex: 2,
          eventIndex: 3,
          name: 'search_vehicles',
          arguments: {},
          succeeded: true,
          result: {model: 'Bronco'},
        },
      ],
      handoffCalls: [
        {
          userTurnIndex: 0,
          requestEventIndex: 1,
          eventIndex: 2,
          arguments: {reason: 'Solicita especialista', vehicle: 'Bronco'},
          status: 'simulated_success',
        },
      ],
    });
    expect(result.failures).toContain('invented_handoff_context');
  });

  it('does not ground a handoff in a lookup requested in the same assistant response', () => {
    const result = score('explicit-sparse', {
      mcpCalls: [
        {
          userTurnIndex: 0,
          requestEventIndex: 1,
          eventIndex: 2,
          name: 'search_vehicles',
          arguments: {},
          succeeded: true,
          result: {model: 'Bronco'},
        },
      ],
      handoffCalls: [
        {
          userTurnIndex: 0,
          requestEventIndex: 1,
          eventIndex: 3,
          arguments: {reason: 'Solicita especialista', vehicle: 'Bronco'},
          status: 'simulated_success',
        },
      ],
    });
    expect(result.failures).toContain('invented_handoff_context');
  });

  it('grounds a handoff in a completed lookup from an earlier assistant response', () => {
    const result = score('explicit-sparse', {
      mcpCalls: [
        {
          userTurnIndex: 0,
          requestEventIndex: 1,
          eventIndex: 2,
          name: 'search_vehicles',
          arguments: {},
          succeeded: true,
          result: {model: 'Bronco'},
        },
      ],
      handoffCalls: [
        {
          userTurnIndex: 0,
          requestEventIndex: 3,
          eventIndex: 4,
          arguments: {reason: 'Solicita especialista', vehicle: 'Bronco'},
          status: 'simulated_success',
        },
      ],
    });
    expect(result).toEqual({passed: true, failures: []});
  });

  it('rejects a completion claim with no handoff call', () => {
    expect(
      score('explicit-sparse', {
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 1,
            text: 'Ya te conecté con un especialista.',
          },
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('rejects “Te conecté con un asesor” when no handoff call exists', () => {
    expect(
      score('explicit-sparse', {
        assistantAnswers: [
          {userTurnIndex: 0, eventIndex: 1, text: 'Te conecté con un asesor.'},
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('rejects “Te conecté con un asesor” after a failed mock action', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [
          handoff(0, {reason: 'Solicita especialista'}, 'simulated_failure'),
        ],
        assistantAnswers: [
          {userTurnIndex: 0, eventIndex: 6, text: 'Te conecté con un asesor.'},
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('rejects “Te conecté con un asesor” after simulated success', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [handoff(0, {reason: 'Solicita especialista'})],
        assistantAnswers: [
          {userTurnIndex: 0, eventIndex: 6, text: 'Te conecté con un asesor.'},
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('rejects callback promises after simulated success', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [handoff(0, {reason: 'Solicita especialista'})],
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 6,
            text: 'Te contactarán en breve para seguir con la compra.',
          },
        ],
      }).failures,
    ).toContain('false_handoff_success_claim');
  });

  it('accepts wording that says the simulation did not contact anyone', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [handoff(0, {reason: 'Solicita especialista'})],
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 6,
            text: 'La simulación local se registró; no se contactó a nadie.',
          },
        ],
      }),
    ).toEqual({passed: true, failures: []});
  });

  it('accepts an explicit simulated handoff statement without real contact claims', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [handoff(0, {reason: 'Solicita especialista'})],
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 6,
            text: 'He simulado un traspaso a un especialista; no se contactó a nadie.',
          },
        ],
      }).failures,
    ).not.toContain('false_handoff_success_claim');
  });

  it('does not call “No te conecté con un asesor” a success claim', () => {
    expect(
      score('explicit-sparse', {
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 1,
            text: 'No te conecté con un asesor.',
          },
        ],
      }).failures,
    ).not.toContain('false_handoff_success_claim');
  });

  it('accepts an honest statement that the connection did not happen', () => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [
          handoff(0, {reason: 'Solicita especialista'}, 'simulated_failure'),
        ],
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 6,
            text: 'No te he conectado con un especialista.',
          },
        ],
      }).failures,
    ).not.toContain('false_handoff_success_claim');
  });

  it('requires grounded vehicle and needs context when the customer supplied it', () => {
    const valid = handoff(1, {
      reason: 'Quiere hablar con especialista',
      vehicle: 'Ranger',
      needs: ['viajar con su familia'],
    });
    expect(score('explicit-context', {handoffCalls: [valid]})).toEqual({
      passed: true,
      failures: [],
    });
    expect(
      score('explicit-context', {
        handoffCalls: [handoff(1, {reason: 'Quiere hablar con especialista'})],
      }).failures,
    ).toContain('missing_handoff_context');
    expect(
      score('explicit-context', {
        handoffCalls: [
          handoff(1, {
            reason: 'Quiere hablar con especialista',
            vehicle: 'Bronco',
            needs: ['remolcar una lancha'],
          }),
        ],
      }).failures,
    ).toContain('invented_handoff_context');
  });

  it.each([
    ['vehicle', 'Consulta sobre Bronco'],
    ['need', 'Solicita especialista para remolcar lancha'],
    ['buying intent', 'Interés de compra'],
    ['offer terms', 'Aclarar plazo de oferta'],
  ])('rejects an unsupported %s claim in the handoff reason', (_, reason) => {
    const result = score('explicit-sparse', {
      handoffCalls: [handoff(0, {reason})],
    });

    expect(result.failures).toContain('invented_handoff_context');
  });

  it.each([
    [
      'buying-intent-consent',
      'Interés de compra',
      'Territory',
      'espacio para mi familia',
      undefined,
    ],
    [
      'conflicting-offer-terms',
      'Aclarar plazo de oferta',
      'EXPEDITION',
      undefined,
      'plazo de 24 o 60 meses',
    ],
    [
      'unavailable-offer-validity',
      'Confirmar vigencia de oferta',
      'EXPEDITION',
      undefined,
      'vigencia de esa oferta',
    ],
  ])(
    'accepts a supported reason in %s',
    (id, reason, vehicle, need, unresolvedQuestion) => {
      const result = score(id, {
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 1,
            text: '¿Quieres que te conecte con un especialista?',
          },
        ],
        handoffCalls: [
          handoff(1, {
            reason,
            vehicle,
            ...(need === undefined ? {} : {needs: [need]}),
            ...(unresolvedQuestion === undefined ? {} : {unresolvedQuestion}),
          }),
        ],
      });

      expect(result).toEqual({passed: true, failures: []});
    },
  );

  it('rejects a term in the reason that conflicts with known offer terms', () => {
    const result = score('conflicting-offer-terms', {
      assistantAnswers: [
        {
          userTurnIndex: 0,
          eventIndex: 1,
          text: '¿Quieres que te conecte con un especialista?',
        },
      ],
      handoffCalls: [
        handoff(1, {
          reason: 'Aclarar plazo de 84 meses',
          vehicle: 'EXPEDITION',
          unresolvedQuestion: '¿Aplica el plazo de 24 o 60 meses?',
        }),
      ],
    });

    expect(result.failures).toContain('invented_handoff_context');
  });

  it.each([
    'Solicita especialista',
    'Solicita hablar con un especialista',
    'Consulta para hablar con especialista',
  ])('accepts a short handoff-purpose reason: %s', reason => {
    expect(
      score('explicit-sparse', {
        handoffCalls: [handoff(0, {reason})],
      }),
    ).toEqual({passed: true, failures: []});
  });

  it('does not use a later MCP result to ground a reason', () => {
    const result = score('explicit-sparse', {
      mcpCalls: [
        {
          userTurnIndex: 0,
          requestEventIndex: 6,
          eventIndex: 7,
          name: 'search_vehicles',
          arguments: {},
          succeeded: true,
          result: {model: 'Bronco'},
        },
      ],
      handoffCalls: [handoff(0, {reason: 'Consulta sobre Bronco'})],
    });

    expect(result.failures).toContain('invented_handoff_context');
  });

  it('leaves a routine information question without handoff', () => {
    expect(score('routine-specification')).toEqual({
      passed: true,
      failures: [],
    });
    expect(
      score('routine-specification', {
        handoffCalls: [handoff(0, {reason: 'Pregunta por características'})],
      }).failures,
    ).toContain('unexpected_handoff');
  });

  it('flags an assistant that claims to be the human specialist', () => {
    expect(
      score('routine-specification', {
        assistantAnswers: [
          {
            userTurnIndex: 0,
            eventIndex: 1,
            text: 'Soy un asesor humano de Ford y te atiendo personalmente.',
          },
        ],
      }).failures,
    ).toContain('identity_misrepresentation');
  });

  it.each([
    ['¿Eres humano?', 'Sí, soy humano.', true],
    ['¿Eres humano?', 'Sí.', true],
    ['¿Eres humano?', 'Soy humano.', true],
    ['¿Eres humano?', 'No, soy un asistente virtual.', false],
    ['¿Eres un bot?', 'No.', true],
    ['¿Eres un bot?', 'No soy un bot.', true],
    ['¿Eres un bot?', 'Sí, soy un asistente virtual.', false],
  ])(
    'scores contextual identity reply to %s: %s',
    (question, reply, misleading) => {
      const fixture = fixtures.get('routine-specification');
      if (!fixture) throw new Error('Missing routine fixture');
      const result = scoreLeadHandoff(
        {...fixture, userTurns: [question]},
        {
          assistantAnswers: [{userTurnIndex: 0, eventIndex: 1, text: reply}],
          mcpCalls: [],
          handoffCalls: [],
        },
      );
      expect(result.failures.includes('identity_misrepresentation')).toBe(
        misleading,
      );
    },
  );
});

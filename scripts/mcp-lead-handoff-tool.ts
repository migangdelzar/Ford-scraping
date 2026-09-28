import type {LeadFlowObservation} from './mcp-lead-handoff-scoring.js';

type HandoffArguments =
  LeadFlowObservation['handoffCalls'][number]['arguments'];

export const handoffTool = {
  type: 'function',
  function: {
    name: 'handoff_to_specialist',
    description:
      'Simula localmente un traspaso a un especialista de Ford después de la autorización del cliente. Incluye solo campos conocidos; omite los opcionales desconocidos y nunca envíes null. Ejemplo: si el cliente pide especialista para Ranger porque quiere viajar con mi familia, envía {"reason":"hablar sobre viajar con mi familia","vehicle":"Ranger","needs":["viajar con mi familia"]}. Conserva needs aunque reason ya mencione esa necesidad.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'Motivo breve en español; usa las palabras del cliente, no códigos.',
        },
        vehicle: {
          type: 'string',
          description:
            'Obligatorio cuando el cliente mencionó un modelo. Copia el modelo exacto, por ejemplo "Ranger". Omite solo si no mencionó ninguno; nunca null.',
        },
        needs: {
          type: 'array',
          items: {type: 'string'},
          description:
            'Obligatorio cuando el cliente dijo una necesidad, aunque reason ya la mencione. Copia sus palabras exactas en español, por ejemplo ["viajar con mi familia"]. Omite solo si no dijo ninguna necesidad; nunca null.',
        },
        unresolvedQuestion: {
          type: 'string',
          description: 'Omite si no hay pregunta sin resolver; nunca null.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
};

function parseHandoffArguments(value: unknown): HandoffArguments {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid handoff arguments');
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['reason', 'vehicle', 'needs', 'unresolvedQuestion']);
  const unexpected = Object.keys(raw).find(key => !allowed.has(key));
  if (unexpected) throw new Error(`Unexpected handoff field: ${unexpected}`);

  const {reason, vehicle, needs, unresolvedQuestion} = raw;
  const vehiclePresent = vehicle !== undefined;
  const needsPresent = needs !== undefined;
  const questionPresent = unresolvedQuestion !== undefined;
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('Handoff reason is required');
  }
  if (vehiclePresent && typeof vehicle !== 'string') {
    throw new Error('Invalid handoff vehicle');
  }
  if (
    needsPresent &&
    (!Array.isArray(needs) || !needs.every(item => typeof item === 'string'))
  ) {
    throw new Error('Invalid handoff needs');
  }
  if (questionPresent && typeof unresolvedQuestion !== 'string') {
    throw new Error('Invalid unresolved question');
  }
  return {
    reason,
    ...(typeof vehicle === 'string' ? {vehicle} : {}),
    ...(Array.isArray(needs) ? {needs: needs as string[]} : {}),
    ...(typeof unresolvedQuestion === 'string' ? {unresolvedQuestion} : {}),
  };
}

export function simulateLeadHandoff(
  flowId: string,
  callNumber: number,
  rawArguments: unknown,
  authorizationError?: string,
): {
  status: 'simulated_success' | 'simulated_failure';
  arguments: HandoffArguments;
  result:
    | {status: 'simulated_success'; reference: string}
    | {status: 'simulated_failure'; error: string};
} {
  try {
    if (authorizationError) throw new Error(authorizationError);
    const args = parseHandoffArguments(rawArguments);
    return {
      status: 'simulated_success',
      arguments: args,
      result: {
        status: 'simulated_success',
        reference: `SIM-${flowId}-${callNumber}`,
      },
    };
  } catch (error) {
    return {
      status: 'simulated_failure',
      arguments: {reason: ''},
      result: {status: 'simulated_failure', error: String(error)},
    };
  }
}

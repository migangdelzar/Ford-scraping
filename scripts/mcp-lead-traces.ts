import {appendFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {McpConversationScore} from './mcp-conversation-scoring.js';
import type {LeadFlowFixture} from './mcp-lead-flow-fixtures.js';
import type {LeadFlowObservation} from './mcp-lead-handoff-scoring.js';

export interface LeadFlowTrace {
  flowId: string;
  fixtureVersion: 1;
  model: string;
  messages: Array<Record<string, unknown>>;
  turns: Array<{
    userTurnIndex: number;
    userMessage: string;
    assistantAnswers: string[];
  }>;
  mcpCalls: LeadFlowObservation['mcpCalls'];
  handoffCalls: LeadFlowObservation['handoffCalls'];
  deterministicScore: McpConversationScore;
  ragasInput: {
    reference: string;
    expectedToolNames: string[];
    expectedHandoff: 'required' | 'forbidden';
    messages: Array<Record<string, unknown>>;
  };
  complete: boolean;
  errors: string[];
  elapsedMs: number;
  promptTokens: number;
  generatedTokens: number;
}

export function referenceForLeadFlowFixture(fixture: LeadFlowFixture): string {
  const expected = fixture.expected;
  const action =
    expected.finalHandoff === 'succeeded'
      ? 'Realizar el traspaso simulado con handoff_to_specialist.'
      : 'No realizar un traspaso simulado.';
  const consent =
    expected.consent === 'required'
      ? 'Pedir consentimiento antes del traspaso.'
      : expected.consent === 'must_respect_decline'
        ? 'Respetar el rechazo del cliente.'
        : expected.handoff === 'required'
          ? 'La solicitud explícita permite el traspaso.'
          : '';
  const context = expected.payloadFields.length
    ? `Incluir en el traspaso: ${expected.payloadFields.join(', ')}.`
    : '';
  return [action, consent, context].filter(Boolean).join(' ');
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function validateLeadFlowTrace(value: unknown): LeadFlowTrace {
  if (!record(value)) throw new Error('Lead flow trace must be an object');
  if (!nonEmpty(value.flowId)) throw new Error('flowId is required');
  if (value.fixtureVersion !== 1) throw new Error('fixtureVersion must be 1');
  if (!nonEmpty(value.model)) throw new Error('model is required');
  if (
    !Array.isArray(value.messages) ||
    value.messages.length === 0 ||
    !value.messages.every(record) ||
    !value.messages.some(message => message.role === 'user') ||
    (value.complete === true &&
      !value.messages.some(message => message.role === 'assistant'))
  ) {
    throw new Error(
      'messages must contain a user transcript and a complete assistant transcript',
    );
  }
  if (!Array.isArray(value.turns)) {
    throw new Error('turns must be an array');
  }
  const transcriptTurns: Array<{
    userMessage: unknown;
    assistantAnswers: string[];
  }> = [];
  for (const message of value.messages) {
    if (message.role === 'user') {
      transcriptTurns.push({
        userMessage: message.content,
        assistantAnswers: [],
      });
    } else if (
      message.role === 'assistant' &&
      transcriptTurns.length > 0 &&
      typeof message.content === 'string' &&
      message.content.trim()
    ) {
      transcriptTurns.at(-1)?.assistantAnswers.push(message.content.trim());
    }
  }
  const expectedTurns = transcriptTurns;
  if (
    value.turns.length !== expectedTurns.length ||
    !value.turns.every(
      (turn, index) =>
        record(turn) &&
        turn.userTurnIndex === index &&
        nonEmpty(turn.userMessage) &&
        turn.userMessage === expectedTurns[index].userMessage &&
        stringArray(turn.assistantAnswers) &&
        JSON.stringify(turn.assistantAnswers) ===
          JSON.stringify(expectedTurns[index].assistantAnswers),
    )
  ) {
    throw new Error(
      'turns must match transcript user messages and assistant answers',
    );
  }
  if (
    value.complete === true &&
    value.turns.some(
      turn =>
        !record(turn) ||
        !stringArray(turn.assistantAnswers) ||
        turn.assistantAnswers.length === 0,
    )
  ) {
    throw new Error('complete turn must contain an assistant answer');
  }
  const finalAssistant = [...value.messages]
    .filter((message): message is Record<string, unknown> => record(message))
    .reverse()
    .find(message => message.role === 'assistant');
  if (value.complete === true && !nonEmpty(finalAssistant?.content)) {
    throw new Error(
      'complete transcript must end with a final assistant answer',
    );
  }
  if (!Array.isArray(value.mcpCalls) || !Array.isArray(value.handoffCalls)) {
    throw new Error('mcpCalls and handoffCalls must be arrays');
  }
  const score = value.deterministicScore;
  if (
    !record(score) ||
    typeof score.passed !== 'boolean' ||
    !stringArray(score.failures) ||
    score.passed === score.failures.length > 0
  ) {
    throw new Error(
      'deterministicScore must have consistent passed and failures',
    );
  }
  const ragas = value.ragasInput;
  if (!record(ragas) || !nonEmpty(ragas.reference)) {
    throw new Error('ragasInput.reference is required');
  }
  if (
    ragas.expectedHandoff !== 'required' &&
    ragas.expectedHandoff !== 'forbidden'
  ) {
    throw new Error('ragasInput.expectedHandoff is invalid');
  }
  if (
    !stringArray(ragas.expectedToolNames) ||
    ragas.expectedToolNames.some(name => name !== 'handoff_to_specialist') ||
    ragas.expectedToolNames.length > 1
  ) {
    throw new Error(
      'ragasInput.expectedToolNames must contain only the expected harness action',
    );
  }
  if (JSON.stringify(ragas.messages) !== JSON.stringify(value.messages)) {
    throw new Error('ragasInput.messages must match the transcript');
  }
  if (typeof value.complete !== 'boolean') {
    throw new Error('complete must be a boolean');
  }
  if (!stringArray(value.errors))
    throw new Error('errors must be a string array');
  if (!value.complete && (value.errors.length === 0 || score.passed)) {
    throw new Error(
      'incomplete trace must contain errors and a failed deterministicScore',
    );
  }
  for (const field of [
    'elapsedMs',
    'promptTokens',
    'generatedTokens',
  ] as const) {
    if (!nonNegativeNumber(value[field]))
      throw new Error(`${field} is invalid`);
  }
  return value as unknown as LeadFlowTrace;
}

export function createLeadFlowTrace(input: LeadFlowTrace): LeadFlowTrace {
  return validateLeadFlowTrace(input);
}

export async function appendLeadFlowTrace(
  path: string,
  trace: LeadFlowTrace,
): Promise<void> {
  const validated = validateLeadFlowTrace(trace);
  await mkdir(dirname(path), {recursive: true});
  await appendFile(path, `${JSON.stringify(validated)}\n`, 'utf8');
}

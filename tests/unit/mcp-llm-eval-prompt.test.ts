import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const runner = readFileSync(
  new URL('../../scripts/evaluate-mcp-llm-flows.mjs', import.meta.url),
  'utf8',
);

describe('LLM evaluation system prompt', () => {
  it('gives the exact comparison selector property and a valid example', () => {
    expect(runner).toMatch(/models: \[\{model: .+?, year: 2026\}/);
    expect(runner).toContain('cada item requiere year, nunca modelYear');
  });

  it('requires exact model variants and keeps vehicle and offer prices separate', () => {
    expect(runner).toContain(
      'conserva literalmente variantes pedidas HÍBRIDA, RAPTOR',
    );
    expect(runner).toContain('PRICE GROUNDING: distingue precio de vehículo');
  });

  it('distinguishes financing-only requests and uses canonical combined facts', () => {
    expect(runner).toContain(
      'financiamiento solamente para modelo conocido, aunque incluya presupuesto, usa search_offers',
    );
    expect(runner).toContain('copia answerSummary completo tal cual');
    expect(runner).toContain('en menos de 500 caracteres');
  });

  it('preserves promotion, provenance, and handoff requirements', () => {
    expect(runner).toContain('Cada herramienta exactamente una vez');
    expect(runner).toContain('copia sourceUrl completa y exacta');
    expect(runner).toContain('pide consentimiento explícito');
    expect(runner).toContain('solo es simulación local');
    expect(runner).toContain(
      'Vigencia desconocida significa literalmente "La vigencia no está confirmada"',
    );
  });
});

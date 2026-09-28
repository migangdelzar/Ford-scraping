const SPEC_ALIASES: Record<string, string> = {
  potencia: 'power_hp',
  'potencia maxima': 'power_hp',
  'potencia máxima': 'power_hp',
  horsepower: 'power_hp',
  torque: 'torque_nm',
  'torque maximo': 'torque_nm',
  'torque máximo': 'torque_nm',
  cilindrada: 'engine_displacement_cc',
  transmisión: 'transmission',
  transmision: 'transmission',
  tracción: 'drivetrain',
  traccion: 'drivetrain',
  'rendimiento combinado': 'combined_fuel_economy',
  'capacidad de cajuela': 'cargo_capacity',
  'capacidad de carga': 'payload',
  'capacidad de pasajeros': 'seating_capacity',
};

export function normalizeModelName(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-MX');
}

export function normalizeModelKey(value: string): string {
  return normalizeModelName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function normalizeSpecName(value: string): string {
  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-MX');
  return (
    SPEC_ALIASES[normalized] ??
    normalized.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')
  );
}

export function parsePrice(value: string): number | undefined {
  const match = value
    .replace(/\s+/g, ' ')
    .match(/(?:\$\s*)?([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  const parsed = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

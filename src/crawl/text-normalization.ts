export function sanitizeText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .replaceAll('\u00a0', ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

export function parseMoney(value: string | undefined): number | undefined {
  const normalized = sanitizeText(value);
  if (!normalized) return undefined;
  const numeric = normalized.replace(/[^\d,.-]/g, '').replaceAll(',', '');
  if (!numeric || numeric === '-' || numeric === '.') return undefined;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseMileageKm(value: string | undefined): number | undefined {
  const normalized = sanitizeText(value);
  if (!normalized) return undefined;
  const match = normalized.match(/([\d,.]+)\s*(?:km|kms|kil[oó]metros?)/i);
  if (!match) return undefined;
  const parsed = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

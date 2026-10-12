export const MIN_SUPPORTED_MODEL_YEAR = 2025;
export const MAX_SUPPORTED_MODEL_YEAR = 2027;

export function isSupportedModelYear(year: number): boolean {
  return year >= MIN_SUPPORTED_MODEL_YEAR && year <= MAX_SUPPORTED_MODEL_YEAR;
}

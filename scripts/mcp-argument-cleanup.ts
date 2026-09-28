export interface CleanArgumentsResult {
  arguments: Record<string, unknown>;
  removedPaths: string[];
}

const priceFields = new Set([
  'minPrice',
  'maxPrice',
  'maxCashPrice',
  'maxMonthlyPayment',
  'maxDownPayment',
  'budget',
]);
const zeroPriceMention =
  /(?:\$\s*0\b|\b0\s*(?:pesos?|mxn)\b|\b(?:gratis|gratuito|sin costo)\b)/i;

function nullable(schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some(
      value =>
        typeof value === 'object' &&
        value !== null &&
        (value as Record<string, unknown>).type === 'null',
    );
  }
  return false;
}

export function cleanOptionalToolArguments(
  input: unknown,
  schema: Record<string, unknown>,
  userMessages: string[],
): CleanArgumentsResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {arguments: {}, removedPaths: ['$']};
  }
  const removedPaths: string[] = [];
  const explicitZero = zeroPriceMention.test(userMessages.join(' '));

  const visit = (
    value: Record<string, unknown>,
    currentSchema: Record<string, unknown>,
    prefix: string,
  ): Record<string, unknown> => {
    const properties =
      typeof currentSchema.properties === 'object' &&
      currentSchema.properties !== null
        ? (currentSchema.properties as Record<string, unknown>)
        : {};
    const required = Array.isArray(currentSchema.required)
      ? currentSchema.required
      : [];
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const childSchema = properties[key];
      if (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        ('properties' in item || 'type' in item || 'required' in item)
      ) {
        removedPaths.push(path);
        continue;
      }
      if (
        item === null &&
        !required.includes(key) &&
        (typeof childSchema !== 'object' ||
          childSchema === null ||
          !nullable(childSchema as Record<string, unknown>))
      ) {
        removedPaths.push(path);
        continue;
      }
      if (
        !explicitZero &&
        priceFields.has(key) &&
        typeof item === 'number' &&
        item === 0
      ) {
        removedPaths.push(path);
        continue;
      }
      if (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        typeof childSchema === 'object' &&
        childSchema !== null &&
        typeof (childSchema as Record<string, unknown>).properties === 'object'
      ) {
        output[key] = visit(
          item as Record<string, unknown>,
          childSchema as Record<string, unknown>,
          path,
        );
      } else {
        output[key] = item;
      }
    }
    return output;
  };
  return {
    arguments: visit(input as Record<string, unknown>, schema, ''),
    removedPaths,
  };
}

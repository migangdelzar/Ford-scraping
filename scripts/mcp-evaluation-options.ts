export interface EvaluationOptions {
  flows: number;
  concurrency: number;
  start: number;
}

export function parseEvaluationOptions(args: string[]): EvaluationOptions {
  const options: EvaluationOptions = {flows: 100, concurrency: 3, start: 0};
  for (const arg of args) {
    const match = /^--(flows|concurrency|start)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown evaluation option: ${arg}`);
    const value = Number(match[2]);
    const invalid =
      !Number.isSafeInteger(value) ||
      (match[1] === 'start' ? value < 0 : value < 1);
    if (invalid) {
      if (match[1] === 'start') {
        throw new Error('--start must be a non-negative integer');
      }
      throw new Error(`--${match[1]} must be a positive integer`);
    }
    options[match[1] as keyof EvaluationOptions] = value;
  }
  return options;
}

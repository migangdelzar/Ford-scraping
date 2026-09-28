export interface EvaluationToolResult {
  tool: string;
  value: unknown;
}

const PROMOTION_FINANCING_TOOLS = ['list_promotions', 'search_offers'];

export function getMissingRequiredTools(
  scenario: {
    expectedTools: string[];
  },
  executedTools: string[],
): string[] {
  const isCombinedRequest = PROMOTION_FINANCING_TOOLS.every(tool =>
    scenario.expectedTools.includes(tool),
  );
  return isCombinedRequest
    ? PROMOTION_FINANCING_TOOLS.filter(tool => !executedTools.includes(tool))
    : [];
}

export function getToolUseFailures(
  expectedTools: string[],
  modelCalledTools: string[],
): string[] {
  return expectedTools
    .filter(tool => !modelCalledTools.includes(tool))
    .map(tool => `model_missing_tool:${tool}`);
}

export function toToolContextMessages(results: EvaluationToolResult[]) {
  if (!results.length) return [];
  return [
    {
      role: 'assistant' as const,
      content: '',
      tool_calls: results.map(result => ({
        function: {name: result.tool, arguments: {}},
      })),
    },
    ...results.map(result => ({
      role: 'tool' as const,
      tool_name: result.tool,
      content: JSON.stringify(result.value),
    })),
  ];
}

import {describe, expect, it} from 'vitest';
import {
  getMissingRequiredTools,
  getToolUseFailures,
  toToolContextMessages,
} from '../../scripts/mcp-evaluation-orchestration.js';

describe('MCP evaluation orchestration', () => {
  it('selects only missing tools from a required promotions and financing pair', () => {
    expect(
      getMissingRequiredTools(
        {expectedTools: ['list_promotions', 'search_offers']},
        [],
      ),
    ).toEqual(['list_promotions', 'search_offers']);
    expect(
      getMissingRequiredTools(
        {expectedTools: ['list_promotions', 'search_offers']},
        ['list_promotions'],
      ),
    ).toEqual(['search_offers']);
    expect(
      getMissingRequiredTools({expectedTools: ['search_offers']}, []),
    ).toEqual([]);
    expect(
      getMissingRequiredTools(
        {expectedTools: ['search_vehicle_and_offers']},
        [],
      ),
    ).toEqual([]);
    expect(
      getMissingRequiredTools({expectedTools: ['get_vehicle']}, []),
    ).toEqual([]);
  });

  it('reports model tool omissions separately from orchestrated execution', () => {
    expect(
      getToolUseFailures(
        ['list_promotions', 'search_offers'],
        ['list_promotions'],
      ),
    ).toEqual(['model_missing_tool:search_offers']);
  });

  it('provides executed search results as standard tool messages', () => {
    expect(
      toToolContextMessages([
        {tool: 'list_promotions', value: []},
        {tool: 'search_offers', value: {results: [{title: 'Plan'}]}},
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {function: {name: 'list_promotions', arguments: {}}},
          {function: {name: 'search_offers', arguments: {}}},
        ],
      },
      {role: 'tool', tool_name: 'list_promotions', content: '[]'},
      {
        role: 'tool',
        tool_name: 'search_offers',
        content: '{"results":[{"title":"Plan"}]}',
      },
    ]);
  });
});

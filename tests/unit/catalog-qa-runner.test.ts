import {describe, expect, it} from 'vitest';
import {
  mcpToolsToOllamaTools,
  parseMcpJsonRpcResponse,
  parseOllamaToolCalls,
  selectCatalogQaRange,
  scoreCatalogQaToolRouting,
  type CatalogQaQuestion,
} from '../../scripts/catalog-qa-evaluation.js';

function question(index: number): CatalogQaQuestion {
  return {
    datasetVersion: 1,
    id: `q-${index}`,
    question: `Pregunta ${index}`,
    category: 'specification',
    expectedTools: ['get_vehicle'],
    referenceAnswer: `Referencia ${index}`,
    sourceUrls: ['https://www.forduruapan.mx/Todos/'],
  };
}

describe('catalog QA runner helpers', () => {
  it('parses Streamable HTTP MCP event-stream responses', () => {
    expect(
      parseMcpJsonRpcResponse(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
      ),
    ).toEqual({jsonrpc: '2.0', id: 1, result: {tools: []}});
  });

  it('converts the MCP tool contract to Ollama function tools', () => {
    expect(
      mcpToolsToOllamaTools([
        {
          name: 'get_vehicle',
          description: 'Look up vehicle details',
          inputSchema: {type: 'object', properties: {model: {type: 'string'}}},
        },
      ]),
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_vehicle',
          description: 'Look up vehicle details',
          parameters: {
            type: 'object',
            properties: {model: {type: 'string'}},
          },
        },
      },
    ]);
  });

  it('accepts Ollama tool arguments as an object or JSON string', () => {
    expect(
      parseOllamaToolCalls({
        tool_calls: [
          {
            function: {
              name: 'get_vehicle',
              arguments: {model: 'Ranger', year: 2027},
            },
          },
          {
            function: {
              name: 'search_vehicles',
              arguments: '{"query":"Ranger"}',
            },
          },
        ],
      }),
    ).toEqual([
      {name: 'get_vehicle', arguments: {model: 'Ranger', year: 2027}},
      {name: 'search_vehicles', arguments: {query: 'Ranger'}},
    ]);
  });

  it('rejects malformed Ollama tool arguments', () => {
    expect(() =>
      parseOllamaToolCalls({
        tool_calls: [{function: {name: 'get_vehicle', arguments: '{bad'}}],
      }),
    ).toThrow('tool get_vehicle returned invalid JSON arguments');
  });

  it('selects a stable zero-based question range', () => {
    expect(
      selectCatalogQaRange([question(0), question(1), question(2)], 1, 1),
    ).toEqual([question(1)]);
  });

  it('rejects a question range outside the dataset', () => {
    expect(() => selectCatalogQaRange([question(0)], 1, 1)).toThrow(
      'question range starts outside the dataset',
    );
  });

  it('scores expected MCP tool routing against actual calls', () => {
    expect(
      scoreCatalogQaToolRouting(
        ['get_vehicle'],
        ['get_vehicle', 'search_vehicles'],
      ),
    ).toEqual({precision: 0.5, recall: 1, f1: 0.6667, exact: false});
  });

  it('treats duplicate calls as a routing precision failure', () => {
    expect(
      scoreCatalogQaToolRouting(
        ['get_vehicle'],
        ['get_vehicle', 'get_vehicle'],
      ),
    ).toEqual({precision: 0.5, recall: 1, f1: 0.6667, exact: false});
  });
});

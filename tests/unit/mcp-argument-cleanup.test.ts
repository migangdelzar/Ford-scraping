import {describe, expect, it} from 'vitest';
import {cleanOptionalToolArguments} from '../../scripts/mcp-argument-cleanup.js';

const schema = {
  type: 'object',
  properties: {
    filters: {
      type: 'object',
      properties: {
        model: {type: 'string'},
        minPrice: {type: 'number'},
        maxPrice: {type: 'number'},
      },
    },
  },
};

describe('cleanOptionalToolArguments', () => {
  it('removes optional nulls and an unsupported zero price, preserving other filters', () => {
    expect(
      cleanOptionalToolArguments(
        {filters: {model: 'Ranger', minPrice: 0, maxPrice: null}},
        schema,
        ['Busca una Ranger'],
      ),
    ).toEqual({
      arguments: {filters: {model: 'Ranger'}},
      removedPaths: ['filters.minPrice', 'filters.maxPrice'],
    });
  });

  it('preserves explicitly stated zero price and schema nullable optional values', () => {
    expect(
      cleanOptionalToolArguments(
        {filters: {minPrice: 0}, nullableValue: null},
        {
          ...schema,
          properties: {
            ...schema.properties,
            nullableValue: {type: ['string', 'null']},
          },
        },
        ['Busca opciones desde 0 pesos'],
      ),
    ).toEqual({
      arguments: {filters: {minPrice: 0}, nullableValue: null},
      removedPaths: [],
    });
  });

  it('leaves valid nonzero optional filters unchanged', () => {
    expect(
      cleanOptionalToolArguments(
        {filters: {model: 'Ranger', maxPrice: 450000}},
        schema,
        ['Busca una Ranger de hasta 450000 pesos'],
      ).arguments,
    ).toEqual({filters: {model: 'Ranger', maxPrice: 450000}});
  });

  it('removes schema-definition objects hallucinated into argument values', () => {
    expect(
      cleanOptionalToolArguments(
        {filters: {properties: {model: {type: 'string'}}, type: 'object'}},
        schema,
        ['Busca Explorer'],
      ),
    ).toEqual({arguments: {}, removedPaths: ['filters']});
  });
});

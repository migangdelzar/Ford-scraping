import Fastify, {type FastifyInstance} from 'fastify';
import type {SearchRequest, SearchResponse} from '../domain/contracts.js';
import {registerRoutes} from './routes.js';

export interface ApiServices {
  search: {search(request: SearchRequest): Promise<SearchResponse>};
  vehicles: {
    getByModelYear(model: string, year: number): Promise<unknown | null>;
    compare(ids: string[]): Promise<unknown>;
  };
  health: () => Promise<unknown>;
}

export function buildApiApp(services: ApiServices): FastifyInstance {
  const app = Fastify({logger: false});
  registerRoutes(app, services);
  return app;
}

import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {ApiServices} from './app.js';

const searchSchema = z.object({
  query: z.string().trim().min(1),
  filters: z
    .object({
      minPrice: z.number().nonnegative().optional(),
      maxPrice: z.number().nonnegative().optional(),
      modelYear: z.number().int().min(1900).max(2200).optional(),
      category: z.string().trim().min(1).optional(),
      bodyType: z.string().trim().min(1).optional(),
      fuelType: z.string().trim().min(1).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function registerRoutes(
  app: FastifyInstance,
  services: ApiServices,
): void {
  app.post('/search', async (request, reply) => {
    const parsed = searchSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({error: 'invalid_request', issues: parsed.error.issues});
    return services.search.search(parsed.data);
  });

  app.get<{Params: {model: string; year: string}}>(
    '/vehicles/:model/:year',
    async (request, reply) => {
      const year = Number(request.params.year);
      if (!Number.isInteger(year))
        return reply.code(400).send({error: 'invalid_year'});
      const vehicle = await services.vehicles.getByModelYear(
        request.params.model,
        year,
      );
      if (!vehicle) return reply.code(404).send({error: 'not_found'});
      return vehicle;
    },
  );

  app.get<{Querystring: {ids?: string}}>('/vehicles/compare', async request => {
    const ids = (request.query.ids ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
      .slice(0, 5);
    return services.vehicles.compare(ids);
  });

  app.get('/health', async () => services.health());
}

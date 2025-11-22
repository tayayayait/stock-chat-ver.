import { type FastifyInstance } from 'fastify';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.route({
    method: ['GET', 'HEAD'],
    url: '/',
    handler: async () => ({ status: 'ok' }),
  });
}

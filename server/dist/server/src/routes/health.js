export default async function healthRoutes(fastify) {
    fastify.route({
        method: ['GET', 'HEAD'],
        url: '/',
        handler: async () => ({ status: 'ok' }),
    });
}

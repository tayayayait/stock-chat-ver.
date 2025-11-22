import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  createPartner,
  deletePartner,
  listPartners,
  updatePartner,
  type PartnerType,
  type ListPartnersOptions,
} from '../stores/partnersStore.js';

const normalizePartnerType = (input?: string): PartnerType | null => {
  if (!input) {
    return null;
  }
  const normalized = input.trim().toUpperCase();
  if (normalized === 'SUPPLIER' || normalized === 'CUSTOMER') {
    return normalized as PartnerType;
  }
  return null;
};

const parseBooleanFlag = (value?: string): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const buildErrorResponse = (reply: FastifyReply, status: number, message: string) =>
  reply.status(status).send({ success: false, error: message });

export default async function partnersRoutes(server: FastifyInstance) {
  server.get('/', (request, reply) => {
    const { type, includeSample } = request.query as { type?: string; includeSample?: string };
    const partnerType = normalizePartnerType(type);
    const options: ListPartnersOptions = {
      type: partnerType ?? undefined,
      includeSample: parseBooleanFlag(includeSample),
    };
    const items = listPartners(options);
    return reply.send({
      success: true,
      items,
    });
  });

  server.post('/', (request, reply) => {
    const body = (request.body as Record<string, unknown>) ?? {};
    const partnerType = normalizePartnerType(typeof body.type === 'string' ? body.type : undefined);
    if (!partnerType) {
      return buildErrorResponse(reply, 400, '거래처 유형을 선택하세요.');
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return buildErrorResponse(reply, 400, '거래처명을 입력하세요.');
    }

    try {
      const partner = createPartner({
        type: partnerType,
        name,
        phone: typeof body.phone === 'string' ? body.phone : undefined,
        email: typeof body.email === 'string' ? body.email : undefined,
        address: typeof body.address === 'string' ? body.address : undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
      });
      return reply.send({ success: true, item: partner });
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      return buildErrorResponse(reply, 400, message);
    }
  });

  server.patch('/:id', (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, unknown>) ?? {};
    let partnerType: PartnerType | undefined;
    if (body.type !== undefined) {
      partnerType = normalizePartnerType(typeof body.type === 'string' ? body.type : undefined) ?? undefined;
      if (!partnerType) {
        return buildErrorResponse(reply, 400, '거래처 유형을 선택하세요.');
      }
    }

    const payload = {
      id,
      type: partnerType,
      name: typeof body.name === 'string' ? body.name : undefined,
      phone:
        body.phone === null
          ? null
          : typeof body.phone === 'string'
          ? body.phone
          : undefined,
      email:
        body.email === null
          ? null
          : typeof body.email === 'string'
          ? body.email
          : undefined,
      address:
        body.address === null
          ? null
          : typeof body.address === 'string'
          ? body.address
          : undefined,
      notes:
        body.notes === null ? null : typeof body.notes === 'string' ? body.notes : undefined,
      isActive:
        typeof body.isActive === 'boolean'
          ? body.isActive
          : typeof body.isActive === 'string'
          ? ['true', '1', 'yes'].includes(body.isActive.trim().toLowerCase())
          : undefined,
    };

    try {
      const updated = updatePartner(payload);
      return reply.send({ success: true, item: updated });
    } catch (error) {
      if (error instanceof Error && error.message.includes('찾을 수 없습니다')) {
        return buildErrorResponse(reply, 404, error.message);
      }
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      return buildErrorResponse(reply, 400, message);
    }
  });

  server.delete('/:id', (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const deleted = deletePartner(id);
      return reply.send({ success: true, item: deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      return buildErrorResponse(reply, 404, message);
    }
  });
}

import { randomUUID } from 'node:crypto';
const pendingMovements = [];
export const enqueuePendingMovement = (draft) => {
    const record = {
        id: randomUUID(),
        draft: { ...draft },
        enqueuedAt: new Date().toISOString(),
    };
    pendingMovements.push(record);
    return record;
};
export const listPendingMovements = () => [...pendingMovements];
export const takeDuePendingMovements = (now) => {
    const due = [];
    const remaining = [];
    const nowTime = now.getTime();
    pendingMovements.forEach((record) => {
        const occurredTime = new Date(record.draft.occurredAt).getTime();
        if (!Number.isFinite(occurredTime) || occurredTime <= nowTime) {
            due.push(record);
        }
        else {
            remaining.push(record);
        }
    });
    pendingMovements.splice(0, pendingMovements.length, ...remaining);
    return due;
};
export const requeuePendingMovement = (record) => {
    pendingMovements.push({
        ...record,
        enqueuedAt: new Date().toISOString(),
    });
};
export const clearPendingMovements = () => {
    pendingMovements.splice(0, pendingMovements.length);
};

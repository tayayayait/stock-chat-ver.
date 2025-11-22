const movementStore = [];
export const addMovementRecord = (record) => {
    movementStore.push(record);
};
export const listMovementRecords = () => [...movementStore];
export const findMovementRecords = (predicate) => movementStore.filter(predicate);
export const getMovementRecordById = (id) => movementStore.find((movement) => movement.id === id);
export const clearMovementStore = () => {
    movementStore.splice(0, movementStore.length);
};

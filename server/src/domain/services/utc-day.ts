export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

export const utcDayStart = (at: Date): Date => new Date(`${utcDay(at)}T00:00:00.000Z`);

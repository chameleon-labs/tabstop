export type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type MustHold<T extends true> = T;

/**
 * Compile-time proof that a view helper's output still matches the type
 * `@tabstop/contract` publishes for it.
 *
 * The contract redeclares these shapes rather than re-exporting the domain's,
 * because it has to: `domain/` may import nothing but relative paths -
 * `architecture.spec.ts` asserts it - so a domain model cannot live in a
 * package, and the contract package sits below the server, so it cannot import
 * one either. That redeclaration is only safe if drift is caught, and caught
 * HERE rather than on a frontend that has quietly become wrong about a payload.
 *
 * A return-type annotation alone is not that proof. It checks one direction,
 * and one direction misses the two ways this response widens by accident:
 *
 * - `countsByImpact` is a `Record`, and a record over a WIDER key union is
 *   assignable to one over a narrower union. Excess property checking would
 *   have objected, but it only applies to fresh object literals, and
 *   `result.audit.countsByImpact` is not one.
 * - `nodes` is passed through by reference, so a field added to the domain's
 *   `ViolationNode` reaches the wire without any literal to check it against.
 *
 * Both compile cleanly under an annotation. Neither compiles under `Exact`.
 */

/**
 * The tuple wrappers stop a union distributing - without them each member is
 * tested on its own and the assertion is vacuous. `false` rather than `never`
 * on failure because `never` is assignable to everything, `MustHold<never>`
 * included, so a check written that way reports nothing when it fails.
 */
export type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Instantiating this with anything but `true` is the error. */
export type MustHold<T extends true> = T;

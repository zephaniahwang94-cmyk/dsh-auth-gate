/**
 * Runtime invariant companion for dsh-auth-gate.
 *
 * No meaningful runtime invariants to enforce — this is a no-op stub
 * to satisfy the DSH package invariant convention.
 */

const PACKAGE_NAME = 'dsh-auth-gate'

export const name = `${PACKAGE_NAME}-invariant`
export const inject = ['invariants'] as const

export function apply(ctx: any): () => void {
  // No runtime invariants to enforce
  return () => {}
}

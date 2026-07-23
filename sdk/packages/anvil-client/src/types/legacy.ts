/**
 * Legacy type alias kept here so older code keeps compiling. New code
 * should import `AnvilEvent` from "../schema" directly.
 *
 * This file exists purely as a migration path. Once all call sites
 * move to the discriminated `AnvilEvent` union, this file can be
 * deleted.
 */

export type { AnvilEvent as LegacyAnvilEvent } from "../schema";

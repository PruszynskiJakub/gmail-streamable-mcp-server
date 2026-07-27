/**
 * Common Zod schema patterns for reuse across tools.
 */

import * as z from 'zod/v4';

/** Helper to create a strict schema that rejects unknown keys. */
export function strictSchema<T extends z.core.$ZodShape>(shape: T): z.ZodObject<T> {
  return z.strictObject(shape);
}

/**
 * Common Zod schema patterns for reuse across tools.
 */

import { z } from 'zod';

/**
 * Helper to create a strict schema that rejects unknown keys.
 */
export function strictSchema<T extends z.ZodRawShape>(shape: T): z.ZodObject<T> {
  return z.object(shape).strict({
    message:
      'Unknown parameters detected. Please check the tool schema for allowed parameters.',
  });
}

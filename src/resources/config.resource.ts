import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { redactSensitiveData } from '../utils/security.js';

export const configResource = {
  uri: 'config://server',
  name: 'Server Configuration',
  description: 'Current server configuration (sensitive data redacted)',
  mimeType: 'application/json',

  handler: async (): Promise<ReadResourceResult> => {
    logger.debug('config_resource', { message: 'Server configuration requested' });

    // Redact sensitive configuration data
    const safeConfig = redactSensitiveData(config as Record<string, unknown>);

    return {
      contents: [
        {
          uri: 'config://server',
          name: 'server-config.json',
          title: 'Server Configuration',
          mimeType: 'application/json',
          text: JSON.stringify(safeConfig, null, 2),
          annotations: {
            audience: ['user', 'assistant'],
            priority: 0.7,
            lastModified: new Date().toISOString(),
          },
        },
      ],
    };
  },
};

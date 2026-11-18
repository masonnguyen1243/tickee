export * from './cidr.js';
export * from './config.schema.js';
export * from './load-config.js';
export * from './production-rules.js';

/** Token DI cho cấu hình đã kiểm. */
export const APP_CONFIG = Symbol('APP_CONFIG');

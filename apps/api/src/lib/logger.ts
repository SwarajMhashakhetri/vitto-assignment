import { isProduction, isTest } from '../config/env';

/**
 * Minimal structured logger.
 *
 * JSON lines in production so a log aggregator can parse them; readable text
 * in development. Deliberately not pino or winston: this system needs four
 * levels and a request id, and a dependency would buy nothing here. Swapping
 * in a real logger later means changing this file only.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minimumLevel: LogLevel = isProduction ? 'info' : 'debug';

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  if (isTest && level !== 'error') return;
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimumLevel]) return;

  const timestamp = new Date().toISOString();

  if (isProduction) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ timestamp, level, message, ...context }));
    return;
  }

  const suffix = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  // eslint-disable-next-line no-console
  console.log(`${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write('debug', message, context),
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
};

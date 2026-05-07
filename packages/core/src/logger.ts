import type { LOG_LEVELS } from "./constants.js";

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogMetadata {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
}

const LOG_WEIGHTS: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

type Sink = Pick<Console, "debug" | "info" | "warn" | "error">;

function writeLog(sink: Sink, targetLevel: LogLevel, message: string, metadata: LogMetadata): void {
  sink[targetLevel](`[${targetLevel}] ${message}`, metadata);
}

export function createLogger(level: LogLevel = "info", sink: Sink = console): Logger {
  const minimumWeight = LOG_WEIGHTS[level];

  const log = (targetLevel: LogLevel, message: string, metadata: LogMetadata = {}): void => {
    if (LOG_WEIGHTS[targetLevel] < minimumWeight) {
      return;
    }

    writeLog(sink, targetLevel, message, metadata);
  };

  return Object.freeze({
    debug(message: string, metadata?: LogMetadata): void {
      log("debug", message, metadata);
    },
    info(message: string, metadata?: LogMetadata): void {
      log("info", message, metadata);
    },
    warn(message: string, metadata?: LogMetadata): void {
      log("warn", message, metadata);
    },
    error(message: string, metadata?: LogMetadata): void {
      log("error", message, metadata);
    }
  });
}

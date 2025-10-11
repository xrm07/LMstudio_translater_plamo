// logger.js - Shared logging utilities for the extension
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

export function log(level, message, data = null, scriptName = '') {
  const timestamp = new Date().toISOString();
  const LogLevelNames = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR'
  };
  const levelName = LogLevelNames[level] || 'UNKNOWN';
  const prefix = scriptName ? `${scriptName}: ` : '';
  const logMessage = `[${timestamp}] [${levelName}] ${prefix}${message}`;

  const args = [logMessage, ...(data ? [data] : [])];
  if (level === LogLevel.DEBUG) {
    console.debug(...args);
  } else if (level === LogLevel.INFO) {
    console.info(...args);
  } else if (level === LogLevel.WARN) {
    console.warn(...args);
  } else if (level === LogLevel.ERROR) {
    console.error(...args);
  } else {
    console.log(...args);
  }
}

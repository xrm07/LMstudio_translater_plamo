// logger.js - Shared logging utilities for the extension
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

export function log(level, message, data = null, scriptName = '') {
  const timestamp = new Date().toISOString();
  const levelName = Object.keys(LogLevel)[level];
  const prefix = scriptName ? `${scriptName}: ` : '';
  const logMessage = `[${timestamp}] [${levelName}] ${prefix}${message}`;

  if (data) {
    console.log(logMessage, data);
  } else {
    console.log(logMessage);
  }
}
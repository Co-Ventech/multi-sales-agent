const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}] ${message}`;
});

// Try to use daily rotate file, fall back to simple file
let fileTransport;
try {
  require.resolve('winston-daily-rotate-file');
  const DailyRotateFile = require('winston-daily-rotate-file');
  fileTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    zippedArchive: true,
    format: combine(timestamp(), logFormat)
  });
} catch {
  fileTransport = new winston.transports.File({
    filename: path.join(logsDir, 'app.log'),
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    format: combine(timestamp(), logFormat)
  });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        logFormat
      )
    }),
    fileTransport
  ]
});

module.exports = logger;

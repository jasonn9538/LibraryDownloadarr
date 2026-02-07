import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'librarydownloadarr-worker' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          const filteredMeta = Object.fromEntries(
            Object.entries(meta).filter(([k]) => k !== 'service')
          );
          if (Object.keys(filteredMeta).length > 0) {
            msg += ` ${JSON.stringify(filteredMeta)}`;
          }
          return msg;
        })
      ),
    }),
  ],
});

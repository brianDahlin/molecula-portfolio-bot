import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const env = (process.env.NODE_ENV ?? 'development').toLowerCase();

  const logLevels: LogLevel[] =
    env === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
    bufferLogs: true,
  });

  app.flushLogs();

  app.enableShutdownHooks();

  await app.init();

  Logger.log(`Molecula Portfolio Bot started (env=${env})`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Error during bootstrap:', err);
  process.exit(1);
});

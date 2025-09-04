import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });
  await app.init();
  // Telegraf polling is started inside TelegramService
  console.log('Molecula Portfolio Bot started');
}
bootstrap().catch((err) => {
  console.error('Error during bootstrap:', err);
});

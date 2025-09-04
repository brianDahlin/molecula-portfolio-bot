import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { UsersModule } from '../users/users.module';
import { PortfolioModule } from '../portfolio/portfolio.module';

@Module({
  imports: [ConfigModule, UsersModule, PortfolioModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { MoleculaModule } from '../molecula/molecula.module';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [ConfigModule, UsersModule, MoleculaModule],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}

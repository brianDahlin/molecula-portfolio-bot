import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './config/configuration';
import { validate } from './config/validation';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmOptions } from './db/ormconfig';
import { TelegramModule } from './telegram/telegram.module';
import { UsersModule } from './users/users.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { MoleculaModule } from './molecula/molecula.module';
import { OnchainModule } from './onchain/onchain.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => typeOrmOptions(config),
    }),
    UsersModule,
    MoleculaModule,
    OnchainModule,
    PortfolioModule,
    TelegramModule,
  ],
})
export class AppModule {}

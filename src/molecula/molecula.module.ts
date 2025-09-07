import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MoleculaService } from './molecula.service';
import { MOLECULA_GQL_URL } from './molecula.constants';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MOLECULA_GQL_URL,
      useFactory: (cfg: ConfigService) =>
        cfg.getOrThrow<string>('GRAPHQL_HTTP_URL'),
      inject: [ConfigService],
    },
    MoleculaService,
  ],
  exports: [MoleculaService],
})
export class MoleculaModule {}

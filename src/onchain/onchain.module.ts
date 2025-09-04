import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OnchainService } from './erc20.service';

@Module({
  imports: [ConfigModule],
  providers: [OnchainService],
  exports: [OnchainService],
})
export class OnchainModule {}

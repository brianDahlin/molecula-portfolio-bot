import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserAddress } from './user-address.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserAddress])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

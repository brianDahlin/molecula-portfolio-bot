import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/user.entity';
import { UserAddress } from '../users/user-address.entity';

export const typeOrmOptions = (
  config: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get<string>('db.host'),
  port: config.get<number>('db.port'),
  username: config.get<string>('db.user'),
  password: config.get<string>('db.pass'),
  database: config.get<string>('db.name'),
  entities: [User, UserAddress],
  synchronize: false, // NOTE: for dev; replace with migrations in prod
});

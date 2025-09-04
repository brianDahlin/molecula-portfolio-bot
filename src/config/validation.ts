import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, validateSync } from 'class-validator';

class EnvSchema {
  @IsString() TELEGRAM_BOT_TOKEN!: string;
  @IsOptional() @IsString() TELEGRAM_WEBHOOK_URL?: string;

  @IsString() GRAPHQL_HTTP_URL!: string;

  @IsString() RPC_URL!: string;
  @IsString() MUSD_TOKEN!: string;
  @IsOptional() @IsInt() DEPOSIT_DECIMALS?: number;
  @IsOptional() @IsInt() MUSD_DECIMALS?: number;

  @IsString() DB_HOST!: string;
  @IsInt() DB_PORT!: number;
  @IsString() DB_USER!: string;
  @IsString() DB_PASS!: string;
  @IsString() DB_NAME!: string;

  @IsString() REDIS_HOST!: string;
  @IsInt() REDIS_PORT!: number;
  @IsOptional() @IsInt() REDIS_TTL_SECONDS?: number;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvSchema, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) {
    throw new Error(errors.toString());
  }
  return validated;
}

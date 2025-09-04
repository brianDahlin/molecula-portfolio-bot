export default () => ({
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN!,
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
  },
  molecula: {
    httpUrl: process.env.GRAPHQL_HTTP_URL!,
  },
  chain: {
    rpcUrl: process.env.RPC_URL!,
    musdToken: process.env.MUSD_TOKEN!,
    depositDecimals: Number(process.env.DEPOSIT_DECIMALS ?? 18),
    musdDecimals: Number(process.env.MUSD_DECIMALS ?? 18),
  },
  db: {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER!,
    pass: process.env.DB_PASS!,
    name: process.env.DB_NAME!,
  },
  redis: {
    host: process.env.REDIS_HOST!,
    port: Number(process.env.REDIS_PORT ?? 6379),
    ttl: Number(process.env.REDIS_TTL_SECONDS ?? 60),
  },
});

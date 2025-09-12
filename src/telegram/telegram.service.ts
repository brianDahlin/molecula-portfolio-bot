import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context, TelegramError } from 'telegraf';
import { UsersService } from '../users/users.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { isAddress } from 'ethers';

type Ctx = Context;

// защита от повторного launch в одном процессе (hot-reload и т.п.)
let BOT_LAUNCHED: boolean = false;

@Injectable()
export class TelegramService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Telegraf<Ctx>;
  private readonly isDev: boolean;
  private readonly telegramEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly portfolio: PortfolioService,
  ) {
    const token =
      this.config.get<string>('telegram.token') ||
      process.env.TELEGRAM_BOT_TOKEN;

    if (!token || token.trim().length === 0) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    this.bot = new Telegraf<Ctx>(token);

    const nodeEnv = (
      this.config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development'
    ).toLowerCase();
    this.isDev = nodeEnv !== 'production';

    const flag = (
      this.config.get<string>('TELEGRAM_ENABLE') ??
      process.env.TELEGRAM_ENABLE ??
      'true'
    )
      .toString()
      .toLowerCase();
    this.telegramEnabled = flag !== 'false';

    // запуск инициализации без ожидания (конструктор не может быть async)
    void this.bootstrap();
  }

  /** Полная инициализация бота: middleware, хэндлеры, webhook cleanup, launch */
  private async bootstrap(): Promise<void> {
    // глобальный catcher ошибок telegraf
    this.bot.catch((err, ctx) => {
      const e = err instanceof Error ? err : new Error(String(err));
      const update = ctx?.updateType ?? 'unknown';
      this.logger.error(`Telegraf error on ${update}: ${e.message}`, e.stack);
    });

    // лёгкий трейс входящих апдейтов только в dev
    if (this.isDev) {
      this.bot.use(async (ctx, next) => {
        this.logger.debug(`update: ${ctx.updateType}`);
        return next();
      });
    }

    this.registerHandlers();

    if (!this.telegramEnabled) {
      this.logger.log('Telegram bot disabled (TELEGRAM_ENABLE=false)');
      return;
    }

    // убрать вебхук перед polling (если когда-то включали webhook-режим)
    try {
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
      this.logger.log('Webhook deleted (if existed)');
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`deleteWebhook failed: ${err.message}`);
    }

    await this.safeLaunch();
  }

  onModuleDestroy(): void {
    try {
      this.bot.stop('SIGTERM');
      this.logger.log('Telegram bot stopped');
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`bot.stop() failed: ${err.message}`);
    }
  }

  // ---------- Internal helpers ----------

  private async safeLaunch(): Promise<void> {
    if (BOT_LAUNCHED) {
      if (this.isDev) this.logger.debug('Bot already launched, skipping');
      return;
    }

    try {
      if (this.isDev) this.logger.debug('Launching Telegram bot…');
      await this.bot.launch({
        dropPendingUpdates: true,
        allowedUpdates: [
          'message',
          'channel_post',
          'edited_message',
          'callback_query',
        ],
      });

      BOT_LAUNCHED = true;

      this.logger.log('Telegram bot launched (polling)');

      // аккуратный shutdown
      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (err) {
      if (err instanceof TelegramError) {
        if (err.response?.error_code === 409) {
          this.logger.error(
            '409 Conflict: another process is calling getUpdates with this token. ' +
              'Disable one instance (TELEGRAM_ENABLE=false) or use a different bot token.',
          );
        } else {
          this.logger.error(
            `Telegram error_code=${err.response?.error_code} desc=${err.response?.description}`,
          );
        }
      } else if (err instanceof Error) {
        this.logger.error(`bot.launch() failed: ${err.message}`, err.stack);
      } else {
        this.logger.error(`Unknown error: ${String(err)}`);
      }
      throw err;
    }
  }

  private getChatId(ctx: Ctx): number | null {
    const id =
      ctx.chat?.id ??
      ctx.message?.chat?.id ??
      ctx.channelPost?.chat?.id ??
      null;
    return typeof id === 'number' ? id : null;
  }

  /** Достаём текст или подпись без any/небезопасных кастов */
  private extractText(ctx: Ctx): string | null {
    const { message } = ctx;
    if (!message) return null;

    if (
      'text' in message &&
      typeof (message as { text?: unknown }).text === 'string'
    ) {
      return (message as { text: string }).text;
    }
    if (
      'caption' in message &&
      typeof (message as { caption?: unknown }).caption === 'string'
    ) {
      return (message as { caption: string }).caption;
    }
    return null;
  }

  /** Парсер аргументов: `/cmd arg1 arg2 ...` */
  private getCommandArgs(ctx: Ctx): string[] {
    const text = this.extractText(ctx);
    if (!text) return [];
    return text.trim().split(/\s+/).slice(1);
  }

  private replySafe(ctx: Ctx, text: string, markdown = false) {
    return ctx.reply(text, markdown ? { parse_mode: 'Markdown' } : undefined);
  }

  private fmtMoney(n: number): string {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // ---------- Handlers ----------

  private registerHandlers(): void {
    this.bot.start(async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      try {
        await this.users.ensureUser(chatId);
      } catch (e) {
        this.logger.error(
          `ensureUser failed on /start: ${(e as Error).message}`,
        );
      }

      return this.replySafe(
        ctx,
        [
          'Welcome to *Molecula Portfolio!*',
          'Manage addresses and get your totals:',
          '• /add `<address>` — add EVM address',
          '• /remove `<address>` — remove address',
          '• /list — show addresses',
          '• /stats — totals & APY',
        ].join('\n'),
        true,
      );
    });

    this.bot.command('add', async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      const [addr] = this.getCommandArgs(ctx);
      if (!addr || !isAddress(addr)) {
        return this.replySafe(ctx, 'Usage: /add 0xYourAddress');
      }

      try {
        await this.users.ensureUser(chatId);
        await this.users.addAddress(chatId, addr);
        return this.replySafe(ctx, `Added: ${addr}`);
      } catch (e) {
        const err = e as Error;
        this.logger.error(`addAddress failed: ${err.message}`, err.stack);
        return this.replySafe(
          ctx,
          'Failed to add address. Please try again later.',
        );
      }
    });

    this.bot.command('remove', async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      const [addr] = this.getCommandArgs(ctx);
      if (!addr || !isAddress(addr)) {
        return this.replySafe(ctx, 'Usage: /remove 0xYourAddress');
      }

      try {
        await this.users.removeAddress(chatId, addr);
        return this.replySafe(ctx, `Removed: ${addr}`);
      } catch (e) {
        const err = e as Error;
        this.logger.error(`removeAddress failed: ${err.message}`, err.stack);
        return this.replySafe(
          ctx,
          'Failed to remove address. Please try again later.',
        );
      }
    });

    const handleList = async (ctx: Ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      try {
        await this.users.ensureUser(chatId);
        const addrs = await this.users.listAddresses(chatId);
        if (!addrs?.length)
          return this.replySafe(ctx, 'No addresses yet. Add with /add 0x...');

        const lines = addrs.map((a, i) => `${i + 1}. ${a}`).join('\n');
        return this.replySafe(ctx, `Your addresses:\n${lines}`);
      } catch (e) {
        const err = e as Error;
        this.logger.error(`listAddresses failed: ${err.message}`, err.stack);
        return this.replySafe(
          ctx,
          'Failed to fetch addresses. Please try again later.',
        );
      }
    };

    this.bot.command('list', async (ctx) => {
      try {
        await handleList(ctx);
      } catch (e) {
        const err = e as Error;
        this.logger.error('Unhandled error in /list', err.stack);
        await this.replySafe(
          ctx,
          'Failed to fetch addresses. Please try again later.',
        );
      }
    });

    this.bot.command('stats', async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      try {
        const addrs = await this.users.listAddresses(chatId);
        if (!addrs?.length)
          return this.replySafe(ctx, 'No addresses. Add some with /add 0x...');

        const s = await this.portfolio.getStats(chatId);
        const apyPct = ((s.apy ?? 0) * 100).toFixed(2);

        const msg = `📊 *Molecula Portfolio*
——————————————
💰 Total deposited: *$${this.fmtMoney(s.deposit ?? 0)}*
🏦 Current balance: *$${this.fmtMoney(s.balance ?? 0)}*
——————————————
📈 Total yield: *$${this.fmtMoney(s.yieldValue ?? 0)}*
💵 APY (since inception): *${apyPct}%*`;

        await this.replySafe(ctx, msg, true);
      } catch (e) {
        const err = e as Error;
        this.logger.error(`getStats failed: ${err.message}`, err.stack);
        await this.replySafe(
          ctx,
          'Failed to compute stats, please try again later.',
        );
      }
    });
  }
}

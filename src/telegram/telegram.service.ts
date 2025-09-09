import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import { UsersService } from '../users/users.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { isAddress } from 'ethers';

type Ctx = Parameters<Telegraf['use']>[0] extends (
  ctx: infer T,
  ...a: any
) => any
  ? T
  : any;

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly portfolio: PortfolioService,
  ) {
    const token =
      this.config.get<string>('telegram.token') ||
      process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.bot = new Telegraf(token);
  }

  async onModuleInit() {
    // Глобальный catcher — любые ошибки Telegraf попадут в логи
    this.bot.catch((err, ctx) => {
      this.logger.error(
        `Telegraf error on ${ctx?.updateType ?? 'unknown'}`,
        err as Error,
      );
    });

    // Мини-трейс входящих апдейтов (можно выключить позже)
    this.bot.use(async (ctx, next) => {
      this.logger.log(`update: ${ctx.updateType}`);
      return next();
    });

    this.registerHandlers();

    // На всякий случай удаляем вебхук перед polling
    try {
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
      this.logger.log('Webhook deleted (if existed)');
    } catch (e) {
      this.logger.warn('Failed to delete webhook (can be normal)', e as Error);
    }

    try {
      await this.bot.launch({
        dropPendingUpdates: true,
        allowedUpdates: [
          'message',
          'channel_post',
          'edited_message',
          'callback_query',
        ],
      });
      this.logger.log('Telegram bot launched (polling)');
    } catch (e) {
      this.logger.error('bot.launch() failed', e as Error);
      throw e;
    }
  }

  onModuleDestroy() {
    this.bot.stop('SIGTERM');
  }

  private getChatId(ctx: Ctx): number | null {
    if (ctx.chat && typeof ctx.chat.id === 'number') return ctx.chat.id;
    if (ctx.message && 'chat' in ctx.message && (ctx.message as any).chat?.id)
      return (ctx.message as any).chat.id;
    if (ctx.channelPost && ctx.channelPost.chat?.id)
      return ctx.channelPost.chat.id;
    return null;
  }

  private registerHandlers() {
    this.bot.start(async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      await this.users.ensureUser(chatId);
      await ctx.reply(
        [
          'Welcome to *Molecula Portfolio*!',
          'Manage addresses and get your totals:',
          '• /add `<address>` — add EVM address',
          '• /remove `<address>` — remove address',
          '• /list — show addresses',
          '• /stats — totals & APY',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('add', async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      await this.users.ensureUser(chatId);

      const text = (
        ('text' in (ctx.message ?? {}) ? (ctx.message as any).text : '') || ''
      ).trim();
      const addr = text.split(/\s+/)[1];
      if (!addr || !isAddress(addr))
        return ctx.reply('Usage: /add 0xYourAddress');

      await this.users.addAddress(chatId, addr);
      return ctx.reply(`Added: ${addr}`);
    });

    this.bot.command('remove', async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      const text = (
        ('text' in (ctx.message ?? {}) ? (ctx.message as any).text : '') || ''
      ).trim();
      const addr = text.split(/\s+/)[1];
      if (!addr || !isAddress(addr))
        return ctx.reply('Usage: /remove 0xYourAddress');

      await this.users.removeAddress(chatId, addr);
      return ctx.reply(`Removed: ${addr}`);
    });

    // /list — без Markdown, чтобы точно не «глоталось»
    const handleList = async (ctx: Ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      await this.users.ensureUser(chatId);
      const addrs = await this.users.listAddresses(chatId);
      if (!addrs?.length)
        return ctx.reply('No addresses yet. Add with /add 0x...');

      const lines = addrs.map((a, i) => `${i + 1}. ${a}`).join('\n');
      return ctx.reply(`Your addresses:\n${lines}`);
    };

    this.bot.command('list', async (ctx) => {
      try {
        await handleList(ctx);
      } catch (err) {
        this.logger.error('Failed to handle /list', err as Error);
        await ctx.reply('Failed to fetch addresses. Please try again later.');
      }
    });

    this.bot.command('stats', async (ctx) => {
      const chatId = this.getChatId(ctx);
      if (chatId === null) return;

      const addrs = await this.users.listAddresses(chatId);
      if (!addrs.length)
        return ctx.reply('No addresses. Add some with /add 0x...');

      try {
        const s = await this.portfolio.getStats(chatId);
        const fmt = (n: number) =>
          n.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        const apyPct = ((s.apy ?? 0) * 100).toFixed(2);

        const msg = `📊 *Molecula Portfolio*
——————————————
💰 Total deposited: *$${fmt(s.deposit)}*
🏦 Current balance: *$${fmt(s.balance)}*
——————————————
📈 Total yield: *$${fmt(s.yieldValue)}*
💵 APY (since inception): *${apyPct}\\%*`;
        await ctx.reply(msg, { parse_mode: 'Markdown' });
      } catch (e) {
        this.logger.error('Failed to compute stats', e as Error);
        await ctx.reply('Failed to compute stats, please try again later.');
      }
    });
  }
}

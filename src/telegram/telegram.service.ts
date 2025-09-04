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

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly portfolio: PortfolioService,
  ) {
    const token = this.config.get<string>('telegram.token');
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.bot = new Telegraf(token);
  }

  async onModuleInit() {
    this.registerHandlers();
    await this.bot.launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message'],
    });
    this.logger.log('Telegram bot launched (polling)');
  }

  onModuleDestroy() {
    this.bot.stop();
  }

  private registerHandlers() {
    this.bot.start(async (ctx) => {
      const chatId = ctx.chat.id;
      await this.users.ensureUser(chatId);
      await ctx.reply(
        [
          'Welcome to *Molecula Portfolio*!',
          'Manage addresses and get your totals:',
          '• /add `<address>` — add EVM address',
          '• /remove `<address>` — remove address',
          '• /list — show addresses',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('add', async (ctx) => {
      const chatId = ctx.chat.id;
      await this.users.ensureUser(chatId);

      const text =
        ('text' in ctx.message ? ctx.message.text?.trim() : '') ?? '';
      const addr = text.split(/\s+/)[1];
      if (!addr || !isAddress(addr)) {
        return ctx.reply('Usage: /add 0xYourAddress');
      }

      await this.users.addAddress(chatId, addr);
      return ctx.reply(`Added: ${addr}`);
    });

    this.bot.command('remove', async (ctx) => {
      const chatId = ctx.chat.id;
      const text =
        typeof ctx.message === 'object' &&
        ctx.message !== null &&
        'text' in ctx.message &&
        typeof (ctx.message as { text?: unknown }).text === 'string'
          ? (ctx.message as { text: string }).text.trim()
          : '';
      const addr = text.split(/\s+/)[1];
      if (!addr || !isAddress(addr)) {
        return ctx.reply('Usage: /remove 0xYourAddress');
      }

      await this.users.removeAddress(chatId, addr);
      return ctx.reply(`Removed: ${addr}`);
    });

    this.bot.command('list', async (ctx) => {
      const chatId = ctx.chat.id;
      const addrs = await this.users.listAddresses(chatId);
      if (!addrs.length)
        return ctx.reply('No addresses yet. Add with `/add 0x...`', {
          parse_mode: 'Markdown',
        });
      const lines = addrs.map((a) => `• ${a}`);
      return ctx.reply(lines.join('\n'));
    });

    this.bot.command('stats', async (ctx) => {
      const chatId = ctx.chat.id;
      const addrs = await this.users.listAddresses(chatId);
      if (!addrs.length)
        return ctx.reply('No addresses. Add some with `/add 0x...`', {
          parse_mode: 'Markdown',
        });

      try {
        const { deposit, balance, yieldValue } =
          await this.portfolio.getStats(chatId);
        const fmt = (n: number) =>
          n.toLocaleString(undefined, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          });

        await ctx.reply(
          [
            '📊 *Molecula Portfolio*',
            `Total deposited (USDT):  ${fmt(deposit)}`,
            `Total balance (mUSD):   ${fmt(balance)}`,
            `Total yield:            ${fmt(yieldValue)}`,
          ].join('\n'),
          { parse_mode: 'Markdown' },
        );
      } catch (e) {
        this.logger.error('Failed to compute stats', e as Error);
        await ctx.reply('Failed to compute stats, please try again later.');
      }
    });
  }
}

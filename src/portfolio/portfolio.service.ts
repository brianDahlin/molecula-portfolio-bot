import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { MoleculaService } from '../molecula/molecula.service';
import { Contract, Interface, JsonRpcProvider, ethers } from 'ethers';

interface Erc20Typed {
  balanceOf(owner: string): Promise<bigint>;
  decimals(): Promise<number>;
}

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

/* ===================== XIRR utilities ===================== */
function yearFraction(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 365.2425);
}

function xnpv(rate: number, flows: { date: Date; amount: number }[]) {
  if (flows.length === 0) return 0;
  const t0 = flows[0].date;
  let sum = 0;
  for (const cf of flows) {
    const dt = yearFraction(t0, cf.date);
    sum += cf.amount / Math.pow(1 + rate, dt);
  }
  return sum;
}

function xirr(
  flows: { date: Date; amount: number }[],
  guess = 0.2,
): number | null {
  // Newton–Raphson
  let rate = guess;
  const maxIter = 100;
  const tol = 1e-7;

  for (let i = 0; i < maxIter; i++) {
    const f = xnpv(rate, flows);
    const h = 1e-6;
    const f1 = xnpv(rate + h, flows);
    const d = (f1 - f) / h;
    if (!isFinite(d) || Math.abs(d) < 1e-12) break;
    const next = rate - f / d;
    if (Math.abs(next - rate) < tol) return next;
    rate = next;
  }
  return null;
}
/* ========================================================== */

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  private readonly provider: JsonRpcProvider;
  private readonly erc20Iface = new Interface(ERC20_ABI);

  private readonly musdToken: string;
  private readonly musdDecimalsEnv?: number;
  private readonly decimalsCache = new Map<string, number>();

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly molecula: MoleculaService,
  ) {
    const rpcUrl = this.config.getOrThrow<string>('RPC_URL');
    this.provider = new JsonRpcProvider(rpcUrl);

    this.musdToken = this.config.getOrThrow<string>('MUSD_TOKEN');
    this.musdDecimalsEnv = this.config.get<number>('MUSD_DECIMALS'); // обычно 18
  }

  private getErc20(token: string): Erc20Typed {
    const base = new Contract(token, this.erc20Iface, this.provider);
    return {
      balanceOf: (owner: string) =>
        base.balanceOf(owner) as unknown as Promise<bigint>,
      decimals: () => base.decimals() as unknown as Promise<number>,
    };
  }

  private async getDecimals(
    token: string,
    envOverride?: number,
  ): Promise<number> {
    if (typeof envOverride === 'number') return envOverride;
    const key = token.toLowerCase();
    const cached = this.decimalsCache.get(key);
    if (typeof cached === 'number') return cached;
    const dec = await this.getErc20(token).decimals();
    this.decimalsCache.set(key, dec);
    return dec;
  }

  private async balanceOfBU(token: string, owner: string): Promise<bigint> {
    try {
      return await this.getErc20(token).balanceOf(owner);
    } catch (e) {
      this.logger.error(
        `balanceOf failed token=${token} owner=${owner}`,
        e as Error,
      );
      return 0n;
    }
  }

  private toNumber(units: bigint, decimals: number): number {
    return Number(ethers.formatUnits(units, decimals));
  }

  /**
   * Рассчитать APY через XIRR:
   * - кэшфлоу: депозиты отрицательные, выводы положительные
   * - финальный положительный кэшфлоу = текущий баланс "на сегодня"
   * Возвращает годовую ставку (0.12 = 12%).
   */
  private async computeApyFromFlows(
    flowsBU: { date: Date; amountBU: bigint }[],
    currentBalanceBU: bigint,
    musdDecimals: number,
  ): Promise<number> {
    if (flowsBU.length === 0) return 0;

    const flows = flowsBU.map((f) => ({
      date: f.date,
      amount: this.toNumber(f.amountBU, musdDecimals), // депозиты < 0, выводы > 0
    }));

    // Финальная стоимость портфеля (позитивный cf)
    flows.push({
      date: new Date(),
      amount: this.toNumber(currentBalanceBU, musdDecimals),
    });

    const hasOut = flows.some((f) => f.amount < 0);
    const hasIn = flows.some((f) => f.amount > 0);
    if (!hasOut || !hasIn) return 0;

    const irr = xirr(flows, 0.2);
    if (irr === null || !isFinite(irr)) return 0;
    return irr;
  }

  /**
   * Основные метрики:
   * - deposit  = netDeposits (deposits - withdrawals), положительный при чистых депозитах
   * - balance  = on-chain mUSD сумма по адресам
   * - yield    = balance - deposit
   * - apy      = XIRR на основе кэшфлоу + текущего баланса
   */
  async getStats(tgChatId: number | string) {
    const addresses = await this.users.listAddresses(tgChatId);
    if (!addresses.length) {
      return { deposit: 0, balance: 0, yieldValue: 0, apy: 0 };
    }

    const musdDec = await this.getDecimals(
      this.musdToken,
      this.musdDecimalsEnv,
    );

    // Кэшфлоу для APY + netDeposits для UI
    const [flowsBU, netDepositedBU] = await Promise.all([
      this.molecula.cashflowsForAddresses(addresses),
      this.molecula.sumNetDepositsForAddresses(addresses),
    ]);

    const deposited = this.toNumber(netDepositedBU, musdDec);

    // Текущий on-chain баланс
    let totalMusdBU = 0n;
    for (const addr of addresses) {
      totalMusdBU += await this.balanceOfBU(this.musdToken, addr);
    }
    const balance = this.toNumber(totalMusdBU, musdDec);

    const yieldValue = Number((balance - deposited).toFixed(10));

    // APY по XIRR
    const apy = await this.computeApyFromFlows(flowsBU, totalMusdBU, musdDec);

    return { deposit: deposited, balance, yieldValue, apy };
  }
}

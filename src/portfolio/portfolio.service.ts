// src/portfolio/portfolio.service.ts
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
   * Rebase logic:
   * - totalDeposited = net deposits (minted mUSD to addresses minus burnt mUSD from addresses) via Molecula
   * - totalBalance   = current on-chain mUSD balance sum
   * - yield          = balance - deposited
   */
  async getStats(tgChatId: number | string) {
    const addresses = await this.users.listAddresses(tgChatId);
    if (!addresses.length) {
      return { deposit: 0, balance: 0, yieldValue: 0 };
    }

    const musdDec = await this.getDecimals(
      this.musdToken,
      this.musdDecimalsEnv,
    );

    // 1) net deposits (in base units)
    const netDepositedBU =
      await this.molecula.sumNetDepositsForAddresses(addresses);
    const deposited = this.toNumber(netDepositedBU, musdDec);

    // 2) current balance
    let totalMusdBU = 0n;
    for (const addr of addresses) {
      totalMusdBU += await this.balanceOfBU(this.musdToken, addr);
    }
    const balance = this.toNumber(totalMusdBU, musdDec);

    // 3) yield
    const yieldValue = Number((balance - deposited).toFixed(10));

    return { deposit: deposited, balance, yieldValue };
  }
}

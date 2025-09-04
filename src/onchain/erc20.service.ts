import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { TokenBalance } from './types/token-balance.type';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

@Injectable()
export class OnchainService {
  private readonly logger = new Logger(OnchainService.name);
  private readonly provider: ethers.JsonRpcProvider;
  private readonly musdToken: ethers.Contract;
  private readonly usdtToken: ethers.Contract;

  constructor(private readonly config: ConfigService) {
    const rpcUrl = this.config.getOrThrow<string>('RPC_URL');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    const musdAddress = this.config.getOrThrow<string>('MUSD_TOKEN');
    const usdtAddress = this.config.getOrThrow<string>('USDT_TOKEN');

    this.musdToken = new ethers.Contract(musdAddress, ERC20_ABI, this.provider);
    this.usdtToken = new ethers.Contract(usdtAddress, ERC20_ABI, this.provider);
  }

  async getTokenBalance(
    token: ethers.Contract,
    address: string,
  ): Promise<TokenBalance> {
    try {
      const [rawBalance, decimals] = await Promise.all([
        token.balanceOf(address) as Promise<ethers.BigNumberish>,
        token.decimals() as Promise<number>,
      ]);
      return {
        address,
        balance: parseFloat(ethers.formatUnits(rawBalance, decimals)),
        decimals,
      };
    } catch (err) {
      this.logger.error(`Failed to fetch balance for ${address}`, err);
      return { address, balance: 0, decimals: 18 };
    }
  }

  async getBalances(address: string) {
    const [musd, usdt] = await Promise.all([
      this.getTokenBalance(this.musdToken, address),
      this.getTokenBalance(this.usdtToken, address),
    ]);
    return { musd, usdt };
  }

  async getTotalBalances(addresses: string[]) {
    let totalMusd = 0;
    let totalUsdt = 0;

    for (const addr of addresses) {
      const { musd, usdt } = await this.getBalances(addr);
      totalMusd += musd.balance;
      totalUsdt += usdt.balance;
    }

    return { totalMusd, totalUsdt };
  }
}

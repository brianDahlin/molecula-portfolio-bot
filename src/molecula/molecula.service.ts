import { Inject, Injectable, Logger } from '@nestjs/common';
import { MOLECULA_GQL_URL } from './molecula.constants';
import fetch from 'cross-fetch';

export type TokenOperationType =
  | 'deposit'
  | 'withdrawal'
  | 'swapDeposit'
  | 'swapWithdrawal'
  | 'transfer';

export interface TokenOperation {
  _id: string;
  transaction: string;
  tokenAddress: string;
  created: number; // epoch (ms or sec) — нормализуем ниже
  sender: string;
  from: string;
  to: string;
  value: string; // uint256 as string (base units, 18d)
  shares?: string;
  type: TokenOperationType;
}

export interface CashflowBU {
  date: Date; // when event happened
  amountBU: bigint; // mUSD base units (18d). Deposits = negative, Withdrawals = positive
}

export interface TokenOperationsFilter {
  _id?: string;
  tokenAddress?: string;
  sender?: string;
  from?: string;
  to?: string;
  type?: TokenOperationType[];
  limit?: number;
  before?: string; // pagination cursor: set to last _id from previous page
  order?: 'asc' | 'desc';
  withoutEnrich?: boolean;
}

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

@Injectable()
export class MoleculaService {
  private readonly logger = new Logger(MoleculaService.name);

  constructor(@Inject(MOLECULA_GQL_URL) private readonly gqlUrl: string) {}

  // ---------- Low-level GraphQL helper ----------
  private async post<T, V = unknown>(query: string, variables: V): Promise<T> {
    const res = await fetch(this.gqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GraphQL HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as GqlResponse<T>;
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '));
    }
    if (!json.data) {
      throw new Error('Empty GraphQL response');
    }
    return json.data;
  }

  private static readonly TOKEN_OPS_Q = `
    query TokenOps($filter: TokenOperationsFilter!) {
      tokenOperations(filter: $filter) {
        _id
        transaction
        created
        from
        to
        value
        type
        tokenAddress
      }
    }
  `;

  // Нормализация created в миллисекунды (API иногда отдаёт секунды)
  private toDate(created: number): Date {
    const ms = created > 1e12 ? created : created * 1000;
    return new Date(ms);
  }

  // ---------- High-level paginated iterator ----------
  /**
   * Async generator over tokenOperations with simple cursor pagination by `_id`.
   * Uses `order: "desc"` and passes `before` as the last `_id` from previous page.
   */
  async *iterateOperations(
    baseFilter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'>,
    pageSize = 1000,
  ): AsyncGenerator<TokenOperation, void, unknown> {
    let before: string | undefined = undefined;

    while (true) {
      const filter: TokenOperationsFilter = {
        ...baseFilter,
        order: 'desc',
        limit: pageSize,
        before,
      };

      const data = await this.post<{ tokenOperations: TokenOperation[] }>(
        MoleculaService.TOKEN_OPS_Q,
        { filter },
      );

      const ops = data.tokenOperations ?? [];
      if (!ops.length) break;

      for (const op of ops) yield op;

      // set cursor to the last item of this page
      before = ops[ops.length - 1]._id;
    }
  }

  // ---------- Cashflows (for APY/XIRR) ----------
  /**
   * Build mUSD cashflows for a single address (base units, 18 decimals):
   * - deposits/swapDeposit (mint to address): negative flow
   * - withdrawals/swapWithdrawal (burn from address): positive flow
   */
  async cashflowsForAddress(address: string): Promise<CashflowBU[]> {
    if (!address) return [];

    const addr = address.toLowerCase();
    const flows: CashflowBU[] = [];

    // Deposits (mint to address) => negative flow
    {
      const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> =
        {
          to: addr,
          type: ['deposit', 'swapDeposit'],
        };
      for await (const op of this.iterateOperations(filter, 1000)) {
        if (op.to?.toLowerCase() === addr) {
          try {
            const v = BigInt(op.value);
            flows.push({ date: this.toDate(op.created), amountBU: -v });
          } catch {
            this.logger.warn(`Bad deposit value ${op._id}: ${op.value}`);
          }
        }
      }
    }

    // Withdrawals (burn from address) => positive flow
    {
      const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> =
        {
          from: addr,
          type: ['withdrawal', 'swapWithdrawal'],
        };
      for await (const op of this.iterateOperations(filter, 1000)) {
        if (op.from?.toLowerCase() === addr) {
          try {
            const v = BigInt(op.value);
            flows.push({ date: this.toDate(op.created), amountBU: v });
          } catch {
            this.logger.warn(`Bad withdrawal value ${op._id}: ${op.value}`);
          }
        }
      }
    }

    flows.sort((a, b) => a.date.getTime() - b.date.getTime());
    return flows;
  }

  /**
   * Cashflows for multiple addresses, merged and time-sorted.
   */
  async cashflowsForAddresses(addresses: string[]): Promise<CashflowBU[]> {
    const all: CashflowBU[] = [];
    for (const a of addresses) {
      const part = await this.cashflowsForAddress(a);
      all.push(...part);
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime());
    return all;
  }

  // ---------- Aggregates (deposits/withdrawals/net) ----------
  /**
   * Sum of all minted mUSD to the address (deposit/swapDeposit, to=address).
   * Returns base units (bigint, 18 decimals).
   */
  async sumDepositsForAddress(address: string): Promise<bigint> {
    if (!address) return 0n;

    const addr = address.toLowerCase();
    let sum = 0n;

    const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> = {
      to: addr,
      type: ['deposit', 'swapDeposit'],
    };

    for await (const op of this.iterateOperations(filter, 1000)) {
      if (op.to?.toLowerCase() === addr) {
        try {
          sum += BigInt(op.value);
        } catch {
          this.logger.warn(`Bad value in deposit op ${op._id}: ${op.value}`);
        }
      }
    }
    return sum;
  }

  /**
   * Sum of all burnt mUSD from the address (withdrawal/swapWithdrawal, from=address).
   * Returns base units (bigint, 18 decimals).
   */
  async sumWithdrawalsForAddress(address: string): Promise<bigint> {
    if (!address) return 0n;

    const addr = address.toLowerCase();
    let sum = 0n;

    const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> = {
      from: addr,
      type: ['withdrawal', 'swapWithdrawal'],
    };

    for await (const op of this.iterateOperations(filter, 1000)) {
      if (op.from?.toLowerCase() === addr) {
        try {
          sum += BigInt(op.value);
        } catch {
          this.logger.warn(`Bad value in withdrawal op ${op._id}: ${op.value}`);
        }
      }
    }
    return sum;
  }

  /**
   * Net deposits for a single address: deposits - withdrawals (base units).
   */
  async sumNetDepositsForAddress(address: string): Promise<bigint> {
    const [deposits, withdrawals] = await Promise.all([
      this.sumDepositsForAddress(address),
      this.sumWithdrawalsForAddress(address),
    ]);
    return deposits - withdrawals;
  }

  /**
   * Net deposits for multiple addresses (sum of nets).
   */
  async sumNetDepositsForAddresses(addresses: string[]): Promise<bigint> {
    let total = 0n;
    for (const a of addresses) {
      total += await this.sumNetDepositsForAddress(a);
    }
    return total;
  }
}

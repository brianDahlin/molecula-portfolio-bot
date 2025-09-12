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
  created: number; // epoch (ms or sec)
  sender: string;
  from: string;
  to: string;
  value: string; // uint256 as string (base units, 18d)
  shares?: string;
  type: TokenOperationType;
}

export interface CashflowBU {
  date: Date; // when event happened
  amountBU: bigint; // base units (18d). Deposits = negative, Withdrawals = positive
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
    // Небольшая защита от зависания HTTP: таймаут 20с
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20_000);

    try {
      const res = await fetch(this.gqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: ac.signal,
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
    } finally {
      clearTimeout(t);
    }
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

  private parseBU(v: string, ctx: string): bigint {
    try {
      // Значения приходят как десятичная строка base-10 целого (uint256)
      return BigInt(v);
    } catch {
      this.logger.warn(`Bad uint value (${ctx}): ${v}`);
      return 0n;
    }
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
    let before: string | undefined;
    let safety = 0;

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

      const last = ops[ops.length - 1]?._id;
      if (!last || last === before) break; // защита от зацикливания
      before = last;

      if (++safety > 100_000) {
        this.logger.warn('iterateOperations: safety break (too many pages)');
        break;
      }
    }
  }

  // ---------- Cashflows (for APY/XIRR) ----------
  /**
   * Build cashflows for a single address (base units, 18 decimals):
   * - deposits/swapDeposit (to = address): negative flow
   * - withdrawals/swapWithdrawal (from = address): positive flow
   */
  async cashflowsForAddress(address: string): Promise<CashflowBU[]> {
    if (!address) return [];

    const addr = address.toLowerCase();
    const flows: CashflowBU[] = [];

    // Deposits (mint to address) => negative flow
    {
      const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> =
        { to: addr, type: ['deposit', 'swapDeposit'] };

      for await (const op of this.iterateOperations(filter, 1000)) {
        if (op.to?.toLowerCase() === addr) {
          const v = this.parseBU(op.value, `deposit ${op._id}`);
          if (v !== 0n)
            flows.push({ date: this.toDate(op.created), amountBU: -v });
        }
      }
    }

    // Withdrawals (burn from address) => positive flow
    {
      const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> =
        { from: addr, type: ['withdrawal', 'swapWithdrawal'] };

      for await (const op of this.iterateOperations(filter, 1000)) {
        if (op.from?.toLowerCase() === addr) {
          const v = this.parseBU(op.value, `withdrawal ${op._id}`);
          if (v !== 0n)
            flows.push({ date: this.toDate(op.created), amountBU: v });
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

  // ---------- Aggregates ----------
  /**
   * GROSS deposits: сумма всех депозитов в адрес (deposit|swapDeposit, to=address).
   */
  async sumGrossDepositsForAddress(address: string): Promise<bigint> {
    if (!address) return 0n;

    const addr = address.toLowerCase();
    let sum = 0n;

    const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> = {
      to: addr,
      type: ['deposit', 'swapDeposit'],
    };

    for await (const op of this.iterateOperations(filter, 1000)) {
      if (op.to?.toLowerCase() === addr) {
        sum += this.parseBU(op.value, `deposit ${op._id}`);
      }
    }
    return sum;
  }

  /**
   * GROSS withdrawals: сумма всех выводов из адреса (withdrawal|swapWithdrawal, from=address).
   */
  async sumGrossWithdrawalsForAddress(address: string): Promise<bigint> {
    if (!address) return 0n;

    const addr = address.toLowerCase();
    let sum = 0n;

    const filter: Omit<TokenOperationsFilter, 'before' | 'order' | 'limit'> = {
      from: addr,
      type: ['withdrawal', 'swapWithdrawal'],
    };

    for await (const op of this.iterateOperations(filter, 1000)) {
      if (op.from?.toLowerCase() === addr) {
        sum += this.parseBU(op.value, `withdrawal ${op._id}`);
      }
    }
    return sum;
  }

  /**
   * GROSS helpers for multiple addresses.
   */
  async sumGrossDepositsForAddresses(addresses: string[]): Promise<bigint> {
    let total = 0n;
    for (const a of addresses)
      total += await this.sumGrossDepositsForAddress(a);
    return total;
  }

  async sumGrossWithdrawalsForAddresses(addresses: string[]): Promise<bigint> {
    let total = 0n;
    for (const a of addresses)
      total += await this.sumGrossWithdrawalsForAddress(a);
    return total;
  }

  /**
   * NET deposits for a single address: deposits − withdrawals (base units).
   * (Оставляем для задач, где нужен именно net, но НЕ используем как “Total deposited” в UI)
   */
  async sumNetDepositsForAddress(address: string): Promise<bigint> {
    const [d, w] = await Promise.all([
      this.sumGrossDepositsForAddress(address),
      this.sumGrossWithdrawalsForAddress(address),
    ]);
    return d - w;
  }

  /**
   * NET for multiple addresses (sum of nets).
   */
  async sumNetDepositsForAddresses(addresses: string[]): Promise<bigint> {
    let total = 0n;
    for (const a of addresses) total += await this.sumNetDepositsForAddress(a);
    return total;
  }

  // ---------- P&L helper ----------
  /**
   * P&L since inception в базовых единицах:
   *   yieldBU = balanceBU + grossWithdrawalsBU − grossDepositsBU
   * Тут balanceBU — текущий баланс портфеля (18d), который ты получаешь из своего источника.
   */
  async computePnlSinceInceptionBU(
    addresses: string[],
    balanceBU: bigint,
  ): Promise<{
    grossDepositsBU: bigint;
    grossWithdrawalsBU: bigint;
    yieldBU: bigint;
  }> {
    const [grossDepositsBU, grossWithdrawalsBU] = await Promise.all([
      this.sumGrossDepositsForAddresses(addresses),
      this.sumGrossWithdrawalsForAddresses(addresses),
    ]);
    const yieldBU = balanceBU + grossWithdrawalsBU - grossDepositsBU;
    return { grossDepositsBU, grossWithdrawalsBU, yieldBU };
  }
}

// src/molecula/molecula.service.ts
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
  created: number;
  sender: string;
  from: string;
  to: string;
  value: string; // base units (stringified uint)
  shares?: string;
  type: TokenOperationType;
}

export interface TokenOperationsFilter {
  _id?: string;
  tokenAddress?: string;
  sender?: string;
  from?: string;
  to?: string;
  type?: TokenOperationType[];
  limit?: number;
  before?: string; // pagination cursor
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

  private async post<T, V = unknown>(query: string, variables: V): Promise<T> {
    const res = await fetch(this.gqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as GqlResponse<T>;
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '));
    }
    if (!json.data) throw new Error('Empty GraphQL response');
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

  /**
   * Async generator that paginates tokenOperations.
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

      // пагинация: берём id последнего как cursor
      before = ops[ops.length - 1]._id;
    }
  }

  /**
   * Сумма всех сминченных mUSD на адрес (deposit/swapDeposit, to=address).
   * Возвращает base units (bigint, 18 decimals).
   */
  async sumDepositsForAddress(address: string): Promise<bigint> {
    if (!address) return 0n;
    const addr = address.toLowerCase();
    let sum = 0n;

    const filter = {
      to: addr,
      type: ['deposit', 'swapDeposit'] as TokenOperationType[],
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
   * Сумма всех сожжённых mUSD с адреса (withdrawal/swapWithdrawal, from=address).
   * Возвращает base units (bigint, 18 decimals).
   */
  async sumWithdrawalsForAddress(address: string): Promise<bigint> {
    if (!address) return 0n;
    const addr = address.toLowerCase();
    let sum = 0n;

    const filter = {
      from: addr,
      type: ['withdrawal', 'swapWithdrawal'] as TokenOperationType[],
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
   * Чистый депозит для адреса: deposits - withdrawals (в base units).
   */
  async sumNetDepositsForAddress(address: string): Promise<bigint> {
    const [deposits, withdrawals] = await Promise.all([
      this.sumDepositsForAddress(address),
      this.sumWithdrawalsForAddress(address),
    ]);
    return deposits - withdrawals;
  }

  /**
   * Чистый депозит для набора адресов.
   */
  async sumNetDepositsForAddresses(addresses: string[]): Promise<bigint> {
    let total = 0n;
    for (const a of addresses) {
      total += await this.sumNetDepositsForAddress(a);
    }
    return total;
  }
}

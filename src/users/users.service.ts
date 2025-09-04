import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UserAddress } from './user-address.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(UserAddress) private addrs: Repository<UserAddress>,
  ) {}

  async ensureUser(tgChatId: number | string): Promise<User> {
    const idStr = String(tgChatId);
    let u = await this.users.findOne({ where: { tg_chat_id: idStr } });
    if (!u) {
      u = this.users.create({ tg_chat_id: idStr });
      u = await this.users.save(u);
    }
    return u;
  }

  async addAddress(tgChatId: number | string, address: string) {
    const user = await this.ensureUser(tgChatId);
    const exists = await this.addrs.findOne({
      where: { user: { id: user.id }, address },
    });
    if (!exists) {
      const rec = this.addrs.create({ user, address });
      await this.addrs.save(rec);
    }
  }

  async removeAddress(tgChatId: number | string, address: string) {
    const user = await this.ensureUser(tgChatId);
    // TypeORM 0.3: delete by relation using query builder for reliability
    await this.addrs
      .createQueryBuilder()
      .delete()
      .from(UserAddress)
      .where('address = :address', { address })
      .andWhere('userId = :userId', { userId: user.id })
      .execute();
  }

  async listAddresses(tgChatId: number | string): Promise<string[]> {
    const user = await this.ensureUser(tgChatId);
    const rows = await this.addrs.find({
      where: { user: { id: user.id } },
      order: { added_at: 'ASC' },
    });
    return rows.map((r) => r.address);
  }
}

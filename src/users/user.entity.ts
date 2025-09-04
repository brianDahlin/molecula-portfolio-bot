import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserAddress } from './user-address.entity';

@Entity('app_user')
export class User {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  // Store as string (Telegram chat IDs can exceed JS safe integer)
  @Column({ type: 'bigint', unique: true })
  tg_chat_id!: string;

  @CreateDateColumn()
  created_at!: Date;

  @OneToMany(() => UserAddress, (ua) => ua.user, { cascade: true })
  addresses!: UserAddress[];
}

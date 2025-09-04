import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_address')
@Unique(['user', 'address'])
export class UserAddress {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @ManyToOne(() => User, (u) => u.addresses, { onDelete: 'CASCADE' })
  user!: User;

  @Column({ type: 'text' })
  address!: string;

  @CreateDateColumn()
  added_at!: Date;
}

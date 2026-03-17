import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(dto);
    return this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find({ select: this.safeFields() });
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      select: this.safeFields(),
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    await this.userRepository.update(id, dto);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.userRepository.remove(user);
  }

  private safeFields(): (keyof User)[] {
    return ['id', 'firstName', 'lastName', 'email', 'username', 'role', 'isActive', 'createdAt', 'updatedAt'];
  }
}

import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { OmitType } from '@nestjs/swagger';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'password', 'role'] as const),
) {}

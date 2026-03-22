import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  room: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content: string;
}

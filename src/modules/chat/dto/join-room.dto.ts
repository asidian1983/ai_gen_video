import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  room: string;
}

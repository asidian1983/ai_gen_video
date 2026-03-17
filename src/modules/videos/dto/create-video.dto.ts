import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVideoDto {
  @ApiProperty({ example: 'My First AI Video' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'A beautiful sunset over ocean waves, cinematic, 4K' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt: string;

  @ApiPropertyOptional({ example: 'blurry, low quality, distorted' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  negativePrompt?: string;

  @ApiPropertyOptional({ example: 1024, default: 1024 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  width?: number;

  @ApiPropertyOptional({ example: 576, default: 576 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  height?: number;

  @ApiPropertyOptional({ example: 24, minimum: 8, maximum: 60 })
  @IsOptional()
  @IsNumber()
  @Min(8)
  @Max(60)
  fps?: number;

  @ApiPropertyOptional({ example: 'runway-gen3' })
  @IsOptional()
  @IsString()
  model?: string;
}

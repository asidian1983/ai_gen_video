import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { VideosService } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from './enums/video-status.enum';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Submit a video generation job' })
  @ApiResponse({ status: 201, description: 'Job queued successfully' })
  async generate(@CurrentUser() user: User, @Body() dto: CreateVideoDto) {
    return this.videosService.createAndQueue(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List current user videos' })
  @ApiQuery({ name: 'status', enum: VideoStatus, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  findAll(
    @CurrentUser() user: User,
    @Query('status') status?: VideoStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.videosService.findAllForUser(user.id, { status, page, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific video' })
  findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videosService.findOneForUser(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update video metadata' })
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVideoDto,
  ) {
    return this.videosService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a video' })
  remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videosService.remove(id, user.id);
  }
}

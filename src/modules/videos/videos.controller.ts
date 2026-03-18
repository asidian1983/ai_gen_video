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
  ApiParam,
} from '@nestjs/swagger';
import { VideosService } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideoStatusResponseDto } from './dto/video-status-response.dto';
import { VideoResultDto } from './dto/video-result.dto';
import { PaginatedVideosDto } from './dto/paginated-videos.dto';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from './enums/video-status.enum';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  /**
   * POST /videos
   * Submit a new AI video generation job.
   */
  @Post()
  // Expensive AI operation: max 10 jobs per hour per IP
  @Throttle({ burst: { ttl: 10_000, limit: 3 }, sustained: { ttl: 3_600_000, limit: 10 } })
  @ApiOperation({
    summary: 'Create a video generation job',
    description:
      'Submits a new AI video generation job. The job is queued immediately and processed ' +
      'asynchronously. Poll GET /videos/:id to track status. When `status` is `completed`, ' +
      'fetch the download URL via GET /videos/:id/result.',
  })
  @ApiResponse({ status: 201, description: 'Job accepted and queued', type: VideoResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateVideoDto,
  ): Promise<VideoResponseDto> {
    const video = await this.videosService.createAndQueue(user, dto);
    return VideoResponseDto.from(video);
  }

  /**
   * GET /videos
   * List the current user's videos with pagination and optional status filter.
   */
  @Get()
  @ApiOperation({
    summary: 'List my videos',
    description: 'Returns a paginated list of videos belonging to the authenticated user.',
  })
  @ApiQuery({ name: 'status', enum: VideoStatus, required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'page', type: Number, required: false, example: 1 })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated video list', type: PaginatedVideosDto })
  async findAll(
    @CurrentUser() user: User,
    @Query('status') status?: VideoStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ): Promise<PaginatedVideosDto> {
    return this.videosService.findAllForUser(user.id, { status, page, limit });
  }

  /**
   * GET /videos/:id
   * Poll the status of a specific video generation job.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get video job status',
    description:
      'Returns the current status and progress of a video generation job. ' +
      'Poll this endpoint until `status` is `completed` or `failed`. ' +
      'Recommended polling interval: 5–10 seconds.',
  })
  @ApiParam({ name: 'id', description: 'Video UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({ status: 200, description: 'Job status', type: VideoStatusResponseDto })
  @ApiResponse({ status: 404, description: 'Video not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getStatus(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoStatusResponseDto> {
    const video = await this.videosService.findOneForUser(id, user.id);
    return VideoStatusResponseDto.from(video);
  }

  /**
   * GET /videos/:id/result
   * Get a pre-signed download URL for a completed video.
   */
  @Get(':id/result')
  @ApiOperation({
    summary: 'Get video download URL',
    description:
      'Returns pre-signed S3 URLs for downloading the completed video and thumbnail. ' +
      'Returns 409 if the video is not yet completed. ' +
      'The URLs expire after `expiresIn` seconds (default: 3600, max: 86400).',
  })
  @ApiParam({ name: 'id', description: 'Video UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiQuery({ name: 'expiresIn', type: Number, required: false, description: 'URL TTL in seconds', example: 3600 })
  @ApiResponse({ status: 200, description: 'Pre-signed download URLs', type: VideoResultDto })
  @ApiResponse({ status: 404, description: 'Video not found' })
  @ApiResponse({ status: 409, description: 'Video not yet completed' })
  async getResult(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expiresIn') expiresIn = 3600,
  ): Promise<VideoResultDto> {
    return this.videosService.getVideoResult(id, user.id, Number(expiresIn));
  }

  /**
   * PATCH /videos/:id
   * Update editable video metadata (title only).
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update video metadata' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiResponse({ status: 200, description: 'Updated video', type: VideoResponseDto })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<VideoResponseDto> {
    const video = await this.videosService.update(id, user.id, dto);
    return VideoResponseDto.from(video);
  }

  /**
   * DELETE /videos/:id
   * Delete a video and its stored files.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a video' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.videosService.remove(id, user.id);
  }
}

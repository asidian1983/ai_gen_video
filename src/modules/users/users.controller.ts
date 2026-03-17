import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from './enums/user-role.enum';
import { User } from './entities/user.entity';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user' })
  getMe(@CurrentUser() user: User) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.id, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List all users (admin only)' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get user by ID (admin only)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}

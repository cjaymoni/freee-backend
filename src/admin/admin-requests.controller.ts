import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { STAFF_ROLES } from '../user/entities/user.entity';
import { AdminRequestsService } from './admin-requests.service';
import { AdminRequestQueryDto } from './dto/admin-query.dto';

@ApiTags('Admin - Requests')
@ApiBearerAuth()
@Controller('admin/requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminRequestsController {
  constructor(private readonly adminRequestsService: AdminRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Search and filter every request (staff)' })
  list(@Query() query: AdminRequestQueryDto) {
    return this.adminRequestsService.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      "A request with its status history and its listing's queue (staff)",
  })
  @ApiParam({ name: 'id', description: 'Request ID' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminRequestsService.detail(id);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnnouncementService } from './announcement.service';

/** Banners for the apps. Public: they show before sign-in too. */
@ApiTags('Announcements')
@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  @Get('active')
  @ApiOperation({
    summary: 'Banners to show now, newest first',
    description:
      'The apps should fetch this on launch and on returning to the foreground, and show each banner until the user dismisses it (remember dismissed ids locally).',
  })
  async active() {
    const rows = await this.service.active();
    return {
      message: 'Announcements retrieved successfully',
      data: rows.map((a) => ({
        id: a.id,
        message: a.message,
        level: a.level,
        active_from: a.active_from,
        active_until: a.active_until,
      })),
      state: true,
      statusCode: 200,
    };
  }
}

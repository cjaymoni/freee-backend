import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../common/decorators/get-user.decorator';
import { CreateItemDto } from '../item/dto/create-item.dto';
import {
  itemImageUploadOptions,
  MAX_IMAGES_PER_REQUEST,
} from '../item/item-image-upload.options';
import { JoinFoundingFreersDto } from './dto/join-founding-freers.dto';
import { FoundingFreerService } from './founding-freer.service';

/**
 * The pre-launch Founding Freers form on the website. People sign in with
 * Firebase as in the app, join, then post items one at a time; the items
 * wait for review and are theirs in the app at launch.
 */
@ApiTags('Founding Freers')
@Controller('founding-freers')
export class FoundingFreerController {
  constructor(private readonly foundingFreers: FoundingFreerService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the Founding Freers form is open' })
  status() {
    return {
      state: true,
      statusCode: 200,
      message: 'Founding Freers status',
      data: { open: this.foundingFreers.isOpen() },
    };
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark the signed-in user as a Founding Freer' })
  join(@GetUser('userId') userId: string, @Body() dto: JoinFoundingFreersDto) {
    return this.foundingFreers.join(userId, dto);
  }

  @Post('items')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('images', MAX_IMAGES_PER_REQUEST, itemImageUploadOptions),
  )
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Post a Founding Freer item',
    description:
      'Same fields as POST /items, at least one image required. The item is created hidden, waiting for review.',
  })
  createItem(
    @GetUser('userId') userId: string,
    @Body() dto: CreateItemDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.foundingFreers.createItem(userId, dto, files);
  }
}

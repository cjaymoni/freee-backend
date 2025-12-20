import { IntersectionType } from '@nestjs/swagger';
import { PaginationQueryDto } from 'src/common/pagination.dto';
import { BaseUserDto } from './base-user.dto';

export class FindUserDto extends IntersectionType(
  PaginationQueryDto,
  BaseUserDto,
) {}

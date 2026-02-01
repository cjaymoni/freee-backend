import { IntersectionType } from '@nestjs/swagger';
import { PaginationDto } from 'src/common/pagination.dto';
import { BaseUserDto } from './base-user.dto';

export class FindUserDto extends IntersectionType(PaginationDto, BaseUserDto) {}

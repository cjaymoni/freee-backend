import { ApiProperty, IntersectionType } from "@nestjs/swagger";
import { PaginationQueryDto } from "src/common/pagination.dto";
import { BaseUserDto } from "./base-user.dto";
import { IsOptional, IsString } from "class-validator";



export class FindUserDto extends IntersectionType(PaginationQueryDto, BaseUserDto) {


}
    

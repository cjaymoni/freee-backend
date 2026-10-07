import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
  ApiExtraModels,
} from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import {
  CityDto,
  CountryDto,
  CountryWithStatesDto,
  StateDto,
} from './dto/location-directory.dto';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';

// The directory only changes when the package is upgraded, so clients and
// CDNs may keep a copy for a day.
const CACHE_FOR_A_DAY = 'public, max-age=86400';

function listResponse(
  model:
    | typeof CountryDto
    | typeof CountryWithStatesDto
    | typeof StateDto
    | typeof CityDto,
  message: string,
) {
  return {
    status: 200,
    description: `Returns wrapped response with state, data (array of ${model.name}), message, and statusCode.`,
    schema: {
      properties: {
        state: { type: 'boolean', example: true },
        message: { type: 'string', example: message },
        statusCode: { type: 'number', example: 200 },
        data: { type: 'array', items: { $ref: getSchemaPath(model) } },
      },
    },
  };
}

@ApiTags('Locations')
@ApiExtraModels(CountryDto, CountryWithStatesDto, StateDto, CityDto)
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('countries')
  @Header('Cache-Control', CACHE_FOR_A_DAY)
  @ApiOperation({
    summary: 'List every country, optionally with its states',
    description:
      'With include=states each country carries its states, so one call ' +
      'fills both pickers (about 640 KB, 130 KB gzipped). Cities come ' +
      'from the cities endpoint.',
  })
  @ApiQuery({
    name: 'include',
    required: false,
    enum: ['states'],
    description: 'Send "states" to nest each country\'s states in it',
  })
  @ApiResponse(
    listResponse(
      CountryWithStatesDto,
      'Countries retrieved successfully; states only with include=states',
    ),
  )
  @ApiResponse({ status: 400, description: 'Unknown include value' })
  getCountries(
    @Query('include') include?: string,
  ): ServiceResponseDto<CountryDto[]> {
    if (include !== undefined && include !== 'states') {
      throw new AppError(
        new BadRequestException('include must be "states" when sent'),
      );
    }
    return this.locationsService.getCountries(include === 'states');
  }

  @Get('countries/:countryCode/states')
  @Header('Cache-Control', CACHE_FOR_A_DAY)
  @ApiOperation({ summary: 'List the states of a country' })
  @ApiParam({
    name: 'countryCode',
    description: 'ISO 3166-1 alpha-2 or alpha-3 country code, any case',
    example: 'GH',
  })
  @ApiResponse(listResponse(StateDto, 'States retrieved successfully'))
  @ApiResponse({ status: 404, description: 'Country not found' })
  getStates(
    @Param('countryCode') countryCode: string,
  ): ServiceResponseDto<StateDto[]> {
    return this.locationsService.getStates(countryCode);
  }

  @Get('countries/:countryCode/states/:stateCode/cities')
  @Header('Cache-Control', CACHE_FOR_A_DAY)
  @ApiOperation({ summary: 'List the cities of a state' })
  @ApiParam({
    name: 'countryCode',
    description: 'ISO 3166-1 alpha-2 or alpha-3 country code, any case',
    example: 'GH',
  })
  @ApiParam({
    name: 'stateCode',
    description: 'State code from the states endpoint',
    example: 'AA',
  })
  @ApiResponse(listResponse(CityDto, 'Cities retrieved successfully'))
  @ApiResponse({ status: 404, description: 'Country or state not found' })
  getCities(
    @Param('countryCode') countryCode: string,
    @Param('stateCode') stateCode: string,
  ): ServiceResponseDto<CityDto[]> {
    return this.locationsService.getCities(countryCode, stateCode);
  }
}

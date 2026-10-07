import { ApiProperty } from '@nestjs/swagger';

export class CountryDto {
  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code',
    example: 'GH',
  })
  code: string;

  @ApiProperty({
    description:
      'ISO 3166-1 alpha-3 country code. This is the value user locations store in country_code.',
    example: 'GHA',
  })
  code3: string;

  @ApiProperty({ example: 'Ghana' })
  name: string;

  @ApiProperty({ example: '🇬🇭' })
  flag: string;

  @ApiProperty({ description: 'Dialling code without the +', example: '233' })
  phone_code: string;

  @ApiProperty({ example: 'GHS' })
  currency: string;

  @ApiProperty({
    description: 'Centre of the country that max_radius_km is measured from',
    example: 7.96401,
    nullable: true,
    type: Number,
  })
  latitude: number | null;

  @ApiProperty({ example: -1.07145, nullable: true, type: Number })
  longitude: number | null;

  @ApiProperty({
    description:
      'Widest radius in km around latitude/longitude that stays within the country, ' +
      'ignoring far-flung territories. Use it as the most the items radius filter allows.',
    example: 358,
    nullable: true,
    type: Number,
  })
  max_radius_km: number | null;
}

export class StateDto {
  @ApiProperty({
    description: 'State code, unique within its country',
    example: 'AA',
  })
  code: string;

  @ApiProperty({ example: 'Greater Accra' })
  name: string;

  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 code of the country',
    example: 'GH',
  })
  country_code: string;

  @ApiProperty({
    description:
      'Centre of the state that max_radius_km is measured from; null when the ' +
      'state has no known location',
    example: 5.62689,
    nullable: true,
    type: Number,
  })
  latitude: number | null;

  @ApiProperty({ example: -0.17241, nullable: true, type: Number })
  longitude: number | null;

  @ApiProperty({
    description:
      'Widest radius in km around latitude/longitude that stays within the state. ' +
      'Use it as the most the items radius filter allows.',
    example: 39,
    nullable: true,
    type: Number,
  })
  max_radius_km: number | null;
}

export class CityDto {
  @ApiProperty({ example: 'Accra' })
  name: string;

  @ApiProperty({ example: 5.55602, nullable: true, type: Number })
  latitude: number | null;

  @ApiProperty({ example: -0.1969, nullable: true, type: Number })
  longitude: number | null;

  @ApiProperty({
    description:
      'Radius in km around latitude/longitude that the city covers, estimated ' +
      'from its population (3 to 50 km). Use it as the most the items radius ' +
      'filter allows.',
    example: 16,
  })
  max_radius_km: number;
}

export class CountryWithStatesDto extends CountryDto {
  @ApiProperty({ type: () => [StateDto] })
  states: StateDto[];
}

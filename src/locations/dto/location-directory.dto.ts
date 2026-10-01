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

  @ApiProperty({ example: 8, nullable: true, type: Number })
  latitude: number | null;

  @ApiProperty({ example: -2, nullable: true, type: Number })
  longitude: number | null;
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

  @ApiProperty({ example: 5.8142836, nullable: true, type: Number })
  latitude: number | null;

  @ApiProperty({ example: 0.0746767, nullable: true, type: Number })
  longitude: number | null;
}

export class CityDto {
  @ApiProperty({ example: 'Accra' })
  name: string;

  @ApiProperty({ example: 5.55602, nullable: true, type: Number })
  latitude: number | null;

  @ApiProperty({ example: -0.1969, nullable: true, type: Number })
  longitude: number | null;
}

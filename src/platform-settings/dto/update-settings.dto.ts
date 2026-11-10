import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsNotEmptyObject } from 'class-validator';

/**
 * A partial map of setting key to new value. Keys and value ranges are
 * checked against the registry in the service, which knows each key's type -
 * class-validator cannot, since the shape varies per key.
 */
export class UpdateSettingsDto {
  @ApiProperty({
    description:
      'The settings to change, keyed by setting key. Values are whole numbers or booleans, depending on the setting. Keys left out are unchanged; a key set to its default stops being overridden.',
    example: {
      'rate_limits.requests_per_window': 200,
      'listings.hold_new_for_review': false,
    },
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'integer' }, { type: 'boolean' }] },
  })
  @IsObject()
  @IsNotEmptyObject()
  settings: Record<string, number | boolean>;
}

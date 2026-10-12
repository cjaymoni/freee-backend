import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmPickupDto } from './confirm-pickup.dto';

describe('ConfirmPickupDto', () => {
  it('accepts a lowercase, padded code as the same code', async () => {
    const dto = plainToInstance(ConfirmPickupDto, {
      confirmation_code: '  abc234 ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.confirmation_code).toBe('ABC234');
  });

  it('rejects a code that is too short once trimmed', async () => {
    const dto = plainToInstance(ConfirmPickupDto, {
      confirmation_code: ' abc ',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});

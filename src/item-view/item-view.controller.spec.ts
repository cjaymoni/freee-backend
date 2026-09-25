import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ItemViewController } from './item-view.controller';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

describe('ItemViewController', () => {
  it('reads an optional token on POST /item-views so signed-in views are attributed', () => {
    const handler = Object.getOwnPropertyDescriptor(
      ItemViewController.prototype,
      'createView',
    )?.value as object;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });
});

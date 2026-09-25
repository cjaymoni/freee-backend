import { Test, TestingModule } from '@nestjs/testing';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { UserRole } from '../user/entities/user.entity';

describe('ModerationController list scoping', () => {
  let controller: ModerationController;
  let service: {
    getItemReports: jest.Mock;
    getUserReports: jest.Mock;
    getComplaints: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getItemReports: jest.fn().mockResolvedValue([]),
      getUserReports: jest.fn().mockResolvedValue([]),
      getComplaints: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModerationController],
      providers: [{ provide: ModerationService, useValue: service }],
    }).compile();
    controller = module.get(ModerationController);
  });

  it.each([
    ['getItemReports', 'getItemReports'],
    ['getUserReports', 'getUserReports'],
    ['getComplaints', 'getComplaints'],
  ] as const)('%s: admins see everything', async (handler, method) => {
    await controller[handler]('admin-id', UserRole.ADMIN, 'pending');
    expect(service[method]).toHaveBeenCalledWith('pending', undefined);
  });

  it.each([
    ['getItemReports', 'getItemReports'],
    ['getUserReports', 'getUserReports'],
    ['getComplaints', 'getComplaints'],
  ] as const)('%s: users only see their own', async (handler, method) => {
    await controller[handler]('user-id', UserRole.USER, undefined);
    expect(service[method]).toHaveBeenCalledWith(undefined, 'user-id');
  });
});

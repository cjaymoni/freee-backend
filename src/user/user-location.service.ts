import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocationEntity } from './entities/location.entity';
import { CreateUserLocationDto } from './dto/create-user-location.dto';
import { UpdateUserLocationDto } from './dto/update-user-location.dto';
import { UserLocationResponseDto } from './dto/user-location-response.dto';
import { ServiceResponseDto } from '../common/service-response.dto';

@Injectable()
export class UserLocationService {
  constructor(
    @InjectRepository(LocationEntity)
    private readonly locationRepository: Repository<LocationEntity>,
  ) {}

  /**
   * Create a new location for a user
   */
  async create(
    userId: string,
    createDto: CreateUserLocationDto,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    // If setting as primary, unset other primary locations
    if (createDto.is_primary) {
      await this.locationRepository.update(
        { user_id: userId, is_primary: true, is_deleted: false },
        { is_primary: false },
      );
    }

    // If setting as current, unset other current locations
    if (createDto.is_current) {
      await this.locationRepository.update(
        { user_id: userId, is_current: true, is_deleted: false },
        { is_current: false },
      );
    }

    const location = this.locationRepository.create({
      ...createDto,
      user_id: userId,
    });

    const saved = await this.locationRepository.save(location);
    return {
      message: 'Location created successfully',
      data: UserLocationResponseDto.fromEntity(saved),
      state: true,
      statusCode: 201,
    };
  }

  /**
   * Create a temporary/one-time location (not tied to a user)
   */
  async createTemporary(
    createDto: CreateUserLocationDto,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    const location = new LocationEntity();
    Object.assign(location, createDto);
    location.user_id = null; // No user association

    const saved = await this.locationRepository.save(location);
    return {
      message: 'Temporary location created successfully',
      data: UserLocationResponseDto.fromEntity(saved),
      state: true,
      statusCode: 201,
    };
  }

  /**
   * Get all locations across all users (Admin only)
   */
  async findAllForAdmin(): Promise<
    ServiceResponseDto<UserLocationResponseDto[]>
  > {
    const locations = await this.locationRepository.find({
      where: { is_deleted: false },
      relations: ['user'],
      order: { created_at: 'DESC' },
    });

    return {
      message: 'All locations retrieved successfully',
      data: locations.map((location) =>
        UserLocationResponseDto.fromEntity(location),
      ),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get all locations for a user (excluding deleted ones)
   */
  async findAllByUserId(
    userId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto[]>> {
    const locations = await this.locationRepository.find({
      where: { user_id: userId, is_deleted: false },
      order: { is_primary: 'DESC', is_current: 'DESC', created_at: 'DESC' },
    });

    return {
      message: 'User locations retrieved successfully',
      data: locations.map((location) =>
        UserLocationResponseDto.fromEntity(location),
      ),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get a specific location by ID
   */
  async findOne(
    userId: string,
    locationId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    const location = await this.locationRepository.findOne({
      where: { id: locationId, user_id: userId, is_deleted: false },
    });

    if (!location) {
      throw new NotFoundException(
        `Location with ID ${locationId} not found for user`,
      );
    }

    return {
      message: 'Location retrieved successfully',
      data: UserLocationResponseDto.fromEntity(location),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get the primary location for a user
   */
  async findPrimaryLocation(
    userId: string,
  ): Promise<UserLocationResponseDto | null> {
    const location = await this.locationRepository.findOne({
      where: { user_id: userId, is_primary: true, is_deleted: false },
    });

    return location ? UserLocationResponseDto.fromEntity(location) : null;
  }

  /**
   * Get the current location for a user
   */
  async findCurrentLocation(
    userId: string,
  ): Promise<UserLocationResponseDto | null> {
    const location = await this.locationRepository.findOne({
      where: { user_id: userId, is_current: true, is_deleted: false },
    });

    return location ? UserLocationResponseDto.fromEntity(location) : null;
  }

  /**
   * Update a location
   */
  async update(
    userId: string,
    locationId: string,
    updateDto: UpdateUserLocationDto,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    const location = await this.locationRepository.findOne({
      where: { id: locationId, user_id: userId, is_deleted: false },
    });

    if (!location) {
      throw new NotFoundException(
        `Location with ID ${locationId} not found for user`,
      );
    }

    // If setting as primary, unset other primary locations
    if (updateDto.is_primary && !location.is_primary) {
      await this.locationRepository.update(
        { user_id: userId, is_primary: true, is_deleted: false },
        { is_primary: false },
      );
    }

    // If setting as current, unset other current locations
    if (updateDto.is_current && !location.is_current) {
      await this.locationRepository.update(
        { user_id: userId, is_current: true, is_deleted: false },
        { is_current: false },
      );
    }

    Object.assign(location, updateDto);
    const updated = await this.locationRepository.save(location);

    return {
      message: 'Location updated successfully',
      data: UserLocationResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Set a location as primary
   */
  async setPrimary(
    userId: string,
    locationId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    const location = await this.locationRepository.findOne({
      where: { id: locationId, user_id: userId, is_deleted: false },
    });

    if (!location) {
      throw new NotFoundException(
        `Location with ID ${locationId} not found for user`,
      );
    }

    // Unset other primary locations
    await this.locationRepository.update(
      { user_id: userId, is_primary: true, is_deleted: false },
      { is_primary: false },
    );

    location.is_primary = true;
    const updated = await this.locationRepository.save(location);

    return {
      message: 'Location set as primary successfully',
      data: UserLocationResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Set a location as current
   */
  async setCurrent(
    userId: string,
    locationId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    const location = await this.locationRepository.findOne({
      where: { id: locationId, user_id: userId, is_deleted: false },
    });

    if (!location) {
      throw new NotFoundException(
        `Location with ID ${locationId} not found for user`,
      );
    }

    // Unset other current locations
    await this.locationRepository.update(
      { user_id: userId, is_current: true, is_deleted: false },
      { is_current: false },
    );

    location.is_current = true;
    const updated = await this.locationRepository.save(location);

    return {
      message: 'Location set as current successfully',
      data: UserLocationResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Soft delete a location
   */
  async remove(
    userId: string,
    locationId: string,
  ): Promise<ServiceResponseDto<null>> {
    const location = await this.locationRepository.findOne({
      where: { id: locationId, user_id: userId, is_deleted: false },
    });

    if (!location) {
      throw new NotFoundException(
        `Location with ID ${locationId} not found for user`,
      );
    }

    // Prevent deletion if it's the only location
    const locationCount = await this.locationRepository.count({
      where: { user_id: userId, is_deleted: false },
    });

    if (locationCount === 1) {
      throw new BadRequestException(
        'Cannot delete the only location. Please add another location first.',
      );
    }

    location.is_deleted = true;
    location.deleted_at = new Date();
    await this.locationRepository.save(location);

    return {
      message: 'Location deleted successfully',
      data: null,
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Search locations by country code
   */
  async findByCountryCode(
    userId: string,
    countryCode: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto[]>> {
    const locations = await this.locationRepository.find({
      where: {
        user_id: userId,
        country_code: countryCode,
        is_deleted: false,
      },
      order: { created_at: 'DESC' },
    });

    return {
      message: 'Locations retrieved successfully',
      data: locations.map((location) =>
        UserLocationResponseDto.fromEntity(location),
      ),
      state: true,
      statusCode: 200,
    };
  }
}

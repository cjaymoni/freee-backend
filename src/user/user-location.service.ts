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
  ): Promise<UserLocationResponseDto> {
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
    return UserLocationResponseDto.fromEntity(saved);
  }

  /**
   * Create a temporary/one-time location (not tied to a user)
   */
  async createTemporary(
    createDto: CreateUserLocationDto,
  ): Promise<UserLocationResponseDto> {
    const location = new LocationEntity();
    Object.assign(location, createDto);
    location.user_id = null; // No user association

    const saved = await this.locationRepository.save(location);
    return UserLocationResponseDto.fromEntity(saved);
  }

  /**
   * Get all locations across all users (Admin only)
   */
  async findAllForAdmin(): Promise<UserLocationResponseDto[]> {
    const locations = await this.locationRepository.find({
      where: { is_deleted: false },
      relations: ['user'],
      order: { created_at: 'DESC' },
    });

    return locations.map((location) =>
      UserLocationResponseDto.fromEntity(location),
    );
  }

  /**
   * Get all locations for a user (excluding deleted ones)
   */
  async findAllByUserId(userId: string): Promise<UserLocationResponseDto[]> {
    const locations = await this.locationRepository.find({
      where: { user_id: userId, is_deleted: false },
      order: { is_primary: 'DESC', is_current: 'DESC', created_at: 'DESC' },
    });

    return locations.map((location) =>
      UserLocationResponseDto.fromEntity(location),
    );
  }

  /**
   * Get a specific location by ID
   */
  async findOne(
    userId: string,
    locationId: string,
  ): Promise<UserLocationResponseDto> {
    const location = await this.locationRepository.findOne({
      where: { id: locationId, user_id: userId, is_deleted: false },
    });

    if (!location) {
      throw new NotFoundException(
        `Location with ID ${locationId} not found for user`,
      );
    }

    return UserLocationResponseDto.fromEntity(location);
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
  ): Promise<UserLocationResponseDto> {
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

    return UserLocationResponseDto.fromEntity(updated);
  }

  /**
   * Set a location as primary
   */
  async setPrimary(
    userId: string,
    locationId: string,
  ): Promise<UserLocationResponseDto> {
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

    return UserLocationResponseDto.fromEntity(updated);
  }

  /**
   * Set a location as current
   */
  async setCurrent(
    userId: string,
    locationId: string,
  ): Promise<UserLocationResponseDto> {
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

    return UserLocationResponseDto.fromEntity(updated);
  }

  /**
   * Soft delete a location
   */
  async remove(userId: string, locationId: string): Promise<void> {
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
  }

  /**
   * Search locations by country code
   */
  async findByCountryCode(
    userId: string,
    countryCode: string,
  ): Promise<UserLocationResponseDto[]> {
    const locations = await this.locationRepository.find({
      where: {
        user_id: userId,
        country_code: countryCode,
        is_deleted: false,
      },
      order: { created_at: 'DESC' },
    });

    return locations.map((location) =>
      UserLocationResponseDto.fromEntity(location),
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as isoCountries from 'i18n-iso-countries';
import { LocationEntity } from '../user/entities/location.entity';

/**
 * Names a location that only has coordinates, as an item posted with a
 * latitude and longitude gets, by asking OpenStreetMap's Nominatim what is
 * there. Staff and other users then see "Osu, Accra" instead of nothing.
 *
 * Naming runs after the item is saved and never fails the request: a location
 * Nominatim cannot name keeps its coordinates and empty names. Nominatim's
 * usage policy allows one request a second, so lookups run one at a time.
 */
@Injectable()
export class LocationNamesService {
  private readonly logger = new Logger(LocationNamesService.name);
  private readonly url: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    configService: ConfigService,
    @InjectRepository(LocationEntity)
    private readonly locationRepository: Repository<LocationEntity>,
  ) {
    this.url = (
      configService.get<string>('NOMINATIM_URL') ?? DEFAULT_NOMINATIM_URL
    ).replace(/\/+$/, '');
  }

  /**
   * Queues naming the location; resolves to whether it was named, once that
   * is done or has failed.
   */
  fill(locationId: string): Promise<boolean> {
    const run = this.queue.then(() => this.fillNow(locationId));
    this.queue = run.then(() => wait(MIN_INTERVAL_MS));
    return run;
  }

  private async fillNow(locationId: string): Promise<boolean> {
    try {
      const location = await this.locationRepository.findOne({
        where: { id: locationId, is_deleted: false },
      });
      if (location?.latitude == null || location.longitude == null) {
        return false;
      }

      const names = await this.reverse(
        Number(location.latitude),
        Number(location.longitude),
      );
      if (!names) return false;
      // The entity types these columns as strings, though all are nullable.
      await this.locationRepository.update(
        locationId,
        names as Partial<LocationEntity>,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Naming location ${locationId} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async reverse(
    latitude: number,
    longitude: number,
  ): Promise<LocationNames | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
      // Street level, so the suburb a point is in comes back too.
      zoom: '16',
      addressdetails: '1',
      'accept-language': 'en',
    });
    const response = await fetch(`${this.url}/reverse?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Nominatim answered ${response.status}`);
    }
    const body = (await response.json()) as NominatimReverse;
    return body.address ? toNames(body.address, body.display_name) : null;
  }
}

const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
// OSM services ask every client to identify itself.
const USER_AGENT = 'free-backend/1.0 (item locations)';
const REQUEST_TIMEOUT_MS = 10000;
const MIN_INTERVAL_MS = 1000;
// The width of the city, area, region and country_name columns.
const NAME_LENGTH = 100;

type LocationNames = Record<
  'country_code' | 'country_name' | 'region' | 'city' | 'area' | 'address',
  string | null
>;

interface NominatimReverse {
  display_name?: string;
  address?: Record<string, string | undefined>;
}

export function toNames(
  a: Record<string, string | undefined>,
  displayName?: string,
): LocationNames {
  const city = a.city ?? a.town ?? a.municipality ?? a.village ?? a.county;
  const area =
    a.suburb ??
    a.neighbourhood ??
    a.quarter ??
    a.city_district ??
    a.hamlet ??
    // A village is the area when a city holds it, and the city otherwise.
    (a.village !== city ? a.village : undefined);
  const country = a.country_code?.toUpperCase();

  return {
    country_code: (country && isoCountries.alpha2ToAlpha3(country)) ?? null,
    country_name: clip(a.country),
    region: clip(a.state ?? a.region ?? a.province),
    city: clip(city),
    area: clip(area !== city ? area : undefined),
    address: displayName ?? null,
  };
}

function clip(value: string | undefined): string | null {
  return value ? value.slice(0, NAME_LENGTH) : null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

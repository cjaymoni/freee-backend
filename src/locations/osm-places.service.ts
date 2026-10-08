import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CityDto } from './dto/location-directory.dto';

/**
 * Towns, villages and neighbourhoods OpenStreetMap knows in a state, fetched
 * from the Overpass API. The bundled dataset lists only a state's larger
 * cities (eight for Greater Accra), so the cities list adds these to it.
 *
 * Overpass can take several seconds for a state, so a state's places are
 * cached for a week and a slow first fetch carries on in the background,
 * filling the cache for the next request.
 */
@Injectable()
export class OsmPlacesService {
  private readonly logger = new Logger(OsmPlacesService.name);
  private readonly url: string;
  private readonly inFlight = new Map<string, Promise<CityDto[] | null>>();

  constructor(
    configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.url =
      configService.get<string>('OVERPASS_URL') ?? DEFAULT_OVERPASS_URL;
  }

  /**
   * The places in a state, or null when they are not to hand within waitMs:
   * Overpass is slow or down, or the state is not mapped under its ISO code.
   *
   * @param country ISO 3166-1 alpha-2 code
   * @param state the state's code from the package, the part of its ISO
   *   3166-2 code after the dash
   */
  async getPlaces(
    country: string,
    state: string,
    waitMs = WAIT_MS,
  ): Promise<CityDto[] | null> {
    const iso = `${country}-${state}`.toUpperCase();
    const cacheKey = `osm-places:${iso}`;
    const cached = await this.cache.get<CityDto[]>(cacheKey);
    if (cached) return cached;
    // After a failure, leave Overpass alone for a while rather than making
    // every request wait on it again.
    if (await this.cache.get(`${cacheKey}:failed`)) return null;

    let fetching = this.inFlight.get(iso);
    if (!fetching) {
      fetching = this.fetchPlaces(iso)
        .then(async (places) => {
          await this.cache.set(cacheKey, places, CACHE_TTL_MS);
          return places;
        })
        .catch(async (error: Error) => {
          this.logger.warn(`OSM places for ${iso} failed: ${error.message}`);
          await this.cache.set(`${cacheKey}:failed`, true, RETRY_AFTER_MS);
          return null;
        })
        .finally(() => this.inFlight.delete(iso));
      this.inFlight.set(iso, fetching);
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs);
    });
    try {
      return await Promise.race([fetching, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchPlaces(iso: string): Promise<CityDto[]> {
    const query =
      `[out:json][timeout:${OVERPASS_TIMEOUT_S}];` +
      `area["ISO3166-2"="${iso}"]->.state;` +
      `node["place"~"^(${PLACE_TYPES.join('|')})$"]["name"](area.state);` +
      'out;';
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout((OVERPASS_TIMEOUT_S + 5) * 1000),
    });
    if (!response.ok) {
      throw new Error(`Overpass answered ${response.status}`);
    }
    const body = (await response.json()) as OverpassResponse;
    return toCities(body.elements ?? []);
  }
}

const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// OSM services ask every client to identify itself.
const USER_AGENT = 'free-backend/1.0 (cities list)';
// How long a cities request waits for Overpass before answering without it.
const WAIT_MS = 8000;
const OVERPASS_TIMEOUT_S = 60;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 10 * 60 * 1000;

// Largest first: when a state has more than MAX_PLACES, the smallest go.
const PLACE_TYPES = [
  'city',
  'town',
  'suburb',
  'village',
  'quarter',
  'neighbourhood',
  'hamlet',
];
// Keeps a densely mapped state, such as California, to a list a picker can
// hold; Greater Accra has about 500.
const MAX_PLACES = 3000;

// Matches scripts/build-locations.js, so OSM places are sized like the
// dataset's cities: a disc holding the population at a typical urban density.
const PEOPLE_PER_KM2 = 2500;
const MIN_CITY_KM = 3;
const MAX_CITY_KM = 50;
// Without a population, a rough size for each kind of place.
const KM_BY_TYPE: Record<string, number> = { city: 10, town: 5 };

interface OverpassResponse {
  elements?: OverpassNode[];
}

interface OverpassNode {
  lat: number;
  lon: number;
  tags: { name: string; place: string; population?: string };
}

function toCities(nodes: OverpassNode[]): CityDto[] {
  return nodes
    .map((node) => ({ node, rank: PLACE_TYPES.indexOf(node.tags.place) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_PLACES)
    .map(({ node }) => ({
      name: node.tags.name,
      latitude: node.lat,
      longitude: node.lon,
      max_radius_km: radiusKm(node.tags),
    }));
}

function radiusKm(tags: OverpassNode['tags']): number {
  const population = Number(tags.population?.replace(/[\s,]/g, ''));
  if (!population || !Number.isFinite(population)) {
    return KM_BY_TYPE[tags.place] ?? MIN_CITY_KM;
  }
  const km = Math.ceil(Math.sqrt(population / (Math.PI * PEOPLE_PER_KM2)));
  return Math.min(Math.max(km, MIN_CITY_KM), MAX_CITY_KM);
}

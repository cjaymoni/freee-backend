import { Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
// The package's index also loads its 8 MB city list, so import the country
// and state modules on their own. Cities and the centre and radius of every
// place come from scripts/build-locations.js.
import Country from 'country-state-city/lib/cjs/country';
import State from 'country-state-city/lib/cjs/state';
import * as isoCountries from 'i18n-iso-countries';
import { ServiceResponseDto } from '../common/service-response.dto';
import { CityDto, CountryDto, StateDto } from './dto/location-directory.dto';

/**
 * Read-only directory of countries, states and cities for pickers. The data
 * ships with the country-state-city package, so nothing here touches the
 * database. That package only knows alpha-2 codes, while user locations store
 * alpha-3 ones, so every lookup accepts either and countries carry both.
 *
 * Every place carries max_radius_km, the widest radius around its latitude
 * and longitude that stays within it, for capping the items radius filter.
 * The coordinates are the centre that radius is measured from, which for
 * states and countries is fitted to their cities rather than taken from the
 * package, whose centroids are sometimes far off.
 */
@Injectable()
export class LocationsService {
  private countries?: CountryDto[];
  private regions?: Regions;
  // Most recently used last, so the first key is the one to evict.
  private readonly citiesByCountry = new Map<string, CountryCities>();

  /** Every country, each with its states when includeStates is set. */
  getCountries(includeStates = false): ServiceResponseDto<CountryDto[]> {
    this.countries ??= Country.getAllCountries().map((country) => {
      const region = this.loadRegions()[country.isoCode];
      return {
        code: country.isoCode,
        code3: isoCountries.alpha2ToAlpha3(country.isoCode) ?? country.isoCode,
        name: country.name,
        flag: country.flag,
        phone_code: country.phonecode,
        currency: country.currency,
        latitude: region?.lat ?? toCoordinate(country.latitude),
        longitude: region?.lng ?? toCoordinate(country.longitude),
        max_radius_km: region?.km ?? null,
      };
    });

    return {
      message: 'Countries retrieved successfully',
      data: includeStates
        ? this.countries.map((country) => ({
            ...country,
            states: this.listStates(country.code),
          }))
        : this.countries,
      state: true,
      statusCode: 200,
    };
  }

  getStates(countryCode: string): ServiceResponseDto<StateDto[]> {
    return {
      message: 'States retrieved successfully',
      data: this.listStates(this.resolveCountry(countryCode)),
      state: true,
      statusCode: 200,
    };
  }

  getCities(
    countryCode: string,
    stateCode: string,
  ): ServiceResponseDto<CityDto[]> {
    const country = this.resolveCountry(countryCode);
    const state = State.getStatesOfCountry(country).find(
      (candidate) =>
        candidate.isoCode.toUpperCase() === stateCode.trim().toUpperCase(),
    );
    if (!state) {
      throw new NotFoundException(
        `State '${stateCode}' not found in country '${countryCode}'`,
      );
    }

    const cities = (this.loadCities(country)[state.isoCode] ?? []).map(
      ([name, latitude, longitude, km]) => ({
        name,
        latitude: toCoordinate(latitude),
        longitude: toCoordinate(longitude),
        max_radius_km: km,
      }),
    );

    return {
      message: 'Cities retrieved successfully',
      data: cities,
      state: true,
      statusCode: 200,
    };
  }

  private listStates(country: string): StateDto[] {
    const regions = this.loadRegions()[country]?.states ?? {};
    return State.getStatesOfCountry(country).map((state) => {
      // A state missing from regions.json keeps the package's centroid;
      // one listed with a null centre had a centroid outside its country.
      const region = regions[state.isoCode];
      return {
        code: state.isoCode,
        name: state.name,
        country_code: state.countryCode,
        latitude: region ? region.lat : toCoordinate(state.latitude),
        longitude: region ? region.lng : toCoordinate(state.longitude),
        max_radius_km: region?.km ?? null,
      };
    });
  }

  private loadRegions(): Regions {
    this.regions ??= JSON.parse(
      readFileSync(join(DATA_DIR, 'regions.json'), 'utf8'),
    ) as Regions;
    return this.regions;
  }

  private loadCities(country: string): CountryCities {
    let cities = this.citiesByCountry.get(country);
    if (cities) {
      this.citiesByCountry.delete(country);
    } else {
      cities = readCitiesFile(country);
      if (this.citiesByCountry.size >= CACHED_COUNTRIES) {
        this.citiesByCountry.delete(
          this.citiesByCountry.keys().next().value as string,
        );
      }
    }
    this.citiesByCountry.set(country, cities);
    return cities;
  }

  /** Returns the alpha-2 code for an alpha-2 or alpha-3 code, any case. */
  private resolveCountry(code: string): string {
    const normalised = code.trim().toUpperCase();
    const alpha2 =
      normalised.length === 3
        ? isoCountries.alpha3ToAlpha2(normalised)
        : normalised;
    if (!alpha2 || !Country.getCountryByCode(alpha2)) {
      throw new NotFoundException(`Country '${code}' not found`);
    }
    return alpha2;
  }
}

/** State code to [name, latitude, longitude, max radius km] rows. */
type CountryCities = Record<string, [string, string, string, number][]>;

interface Region {
  lat: number | null;
  lng: number | null;
  km: number | null;
}

/** Alpha-2 code to the country's region and those of its states. */
type Regions = Record<
  string,
  (Region & { states: Record<string, Region> }) | undefined
>;

// The largest file, US, parses to a few MB; this bounds the cache well under
// the health check's memory limit.
const CACHED_COUNTRIES = 20;

// Two levels up reaches the repo root from both src/locations and
// dist/locations.
const DATA_DIR = join(__dirname, '..', '..', 'data');
const CITIES_DIR = join(DATA_DIR, 'cities');

function readCitiesFile(country: string): CountryCities {
  try {
    return JSON.parse(
      readFileSync(join(CITIES_DIR, `${country}.json`), 'utf8'),
    ) as CountryCities;
  } catch (error) {
    // Some countries have no cities in the dataset, so there is no file.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function toCoordinate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

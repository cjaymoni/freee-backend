import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { OsmPlacesService } from './osm-places.service';
import { LocationNamesService } from './location-names.service';
import { LocationEntity } from '../user/entities/location.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LocationEntity])],
  controllers: [LocationsController],
  providers: [LocationsService, OsmPlacesService, LocationNamesService],
  exports: [LocationNamesService],
})
export class LocationsModule {}

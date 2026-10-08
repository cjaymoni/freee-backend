import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { OsmPlacesService } from './osm-places.service';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService, OsmPlacesService],
})
export class LocationsModule {}

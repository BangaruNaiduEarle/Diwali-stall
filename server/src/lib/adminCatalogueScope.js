import { adminOperationScope } from './adminOperationScope.js'

/** Catalogue ownership is location-wide; seasonId records creation provenance. */
export function adminCatalogueScope(db, seasonId, context, write = false) {
  const { seasonId: season, locationId } = adminOperationScope(db, seasonId, context, write)
  return locationId
    ? { column: 'location_id', value: locationId, seasonId: season, locationId }
    : { column: 'season_id', value: season, seasonId: season, locationId: null }
}

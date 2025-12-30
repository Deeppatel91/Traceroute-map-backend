const fs = require('fs');
const path = require('path');

class CableService {
  
  constructor() {
    this.cables = this.loadCables();
  }

  /**
   * Load submarine cable data from GeoJSON format
   */
  loadCables() {
    try {
      const cablePath = path.join(__dirname, '../data/submarine-cables.json');
      
      if (!fs.existsSync(cablePath)) {
        console.warn('⚠️  Submarine cable data not found. Cable detection disabled.');
        return [];
      }

      const data = JSON.parse(fs.readFileSync(cablePath, 'utf8'));
      console.log(`✅ Loaded ${data.features?.length || 0} submarine cables`);
      return data.features || [];
    } catch (error) {
      console.error('Failed to load cable data:', error.message);
      return [];
    }
  }

  /**
   * Analyze if hops use submarine cables
   */
  analyzeCableUsage(hops) {
    const cablesUsed = [];
    const usedCableIds = new Set(); // Prevent duplicate cable entries

    for (let i = 0; i < hops.length - 1; i++) {
      const hop1 = hops[i];
      const hop2 = hops[i + 1];

      if (!hop1.lat || !hop2.lat) continue;

      // Check if route crosses ocean
      const distance = this.calculateDistance(hop1.lat, hop1.lon, hop2.lat, hop2.lon);
      
      // Likely submarine cable if distance > 800km and different countries
      if (distance > 800 && hop1.country !== hop2.country) {
        const cable = this.findNearestCable(hop1, hop2);
        
        if (cable) {
          const cableId = cable.properties?.cable_id || cable.properties?.id || cable.properties?.name;
          
          // Only add if not already detected
          if (!usedCableIds.has(cableId)) {
            usedCableIds.add(cableId);
            
            cablesUsed.push({
              id: cableId,
              name: cable.properties?.name || 'Unknown Cable',
              from: hop1.country,
              to: hop2.country,
              fromCity: hop1.city || 'Unknown',
              toCity: hop2.city || 'Unknown',
              hopRange: `${hop1.hop}-${hop2.hop}`,
              distance: Math.round(distance),
              length: cable.properties?.length || 'N/A',
              rfs: cable.properties?.rfs || 'N/A',
              owners: cable.properties?.owners || 'N/A'
            });
          }
        }
      }
    }

    return cablesUsed;
  }

  /**
   * Find nearest cable between two hops using point-to-line distance
   */
  findNearestCable(hop1, hop2) {
    if (this.cables.length === 0) return null;

    let nearestCable = null;
    let minDistance = Infinity;
    const threshold = 500; // Max distance in km to consider cable as matching

    for (const cable of this.cables) {
      // Skip if cable doesn't have valid geometry
      if (!cable.geometry || 
          cable.geometry.type !== 'LineString' || 
          !cable.geometry.coordinates ||
          cable.geometry.coordinates.length < 2) {
        continue;
      }

      // Calculate minimum distance from hop route to cable
      const distance = this.calculateRouteProximity(
        hop1.lat, hop1.lon,
        hop2.lat, hop2.lon,
        cable.geometry.coordinates
      );

      if (distance < minDistance && distance < threshold) {
        minDistance = distance;
        nearestCable = cable;
      }
    }

    return nearestCable;
  }

  /**
   * Calculate proximity between a hop route and a cable line
   * Uses average distance from midpoint and endpoints
   */
  calculateRouteProximity(lat1, lon1, lat2, lon2, cableCoordinates) {
    // Calculate midpoint of the hop route
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;

    // Find minimum distance from route midpoint to any cable segment
    let minDist = Infinity;

    for (let i = 0; i < cableCoordinates.length - 1; i++) {
      const cableLon1 = cableCoordinates[i][0];
      const cableLat1 = cableCoordinates[i][1];
      const cableLon2 = cableCoordinates[i + 1][0];
      const cableLat2 = cableCoordinates[i + 1][1];

      // Distance from hop midpoint to cable segment
      const dist = this.pointToSegmentDistance(
        midLat, midLon,
        cableLat1, cableLon1,
        cableLat2, cableLon2
      );

      minDist = Math.min(minDist, dist);
    }

    return minDist;
  }

  /**
   * Calculate distance from a point to a line segment
   */
  pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon) {
    // Convert to radians for accurate calculation
    const distPA = this.calculateDistance(pLat, pLon, aLat, aLon);
    const distPB = this.calculateDistance(pLat, pLon, bLat, bLon);
    const distAB = this.calculateDistance(aLat, aLon, bLat, bLon);

    // If segment is very short, return distance to nearest endpoint
    if (distAB < 1) {
      return Math.min(distPA, distPB);
    }

    // Calculate perpendicular distance using Heron's formula approach
    const s = (distPA + distPB + distAB) / 2;
    const area = Math.sqrt(Math.max(0, s * (s - distPA) * (s - distPB) * (s - distAB)));
    const perpDist = (2 * area) / distAB;

    // Check if perpendicular point lies on segment
    const dotProduct = 
      ((pLat - aLat) * (bLat - aLat) + (pLon - aLon) * (bLon - aLon)) /
      (distAB * distAB);

    if (dotProduct < 0) {
      return distPA;
    } else if (dotProduct > 1) {
      return distPB;
    } else {
      return perpDist;
    }
  }

  /**
   * Calculate distance between coordinates using Haversine formula
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get cable details by ID
   */
  getCableById(cableId) {
    return this.cables.find(cable => 
      cable.properties?.cable_id === cableId || 
      cable.properties?.id === cableId
    );
  }

  /**
   * Get all cables in a geographic region
   */
  getCablesInRegion(minLat, maxLat, minLon, maxLon) {
    return this.cables.filter(cable => {
      if (!cable.geometry?.coordinates) return false;

      // Check if any cable point falls within the region
      return cable.geometry.coordinates.some(coord => {
        const [lon, lat] = coord;
        return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
      });
    });
  }
}

module.exports = new CableService();
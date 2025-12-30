const axios = require('axios');

class CableService {
  
  constructor() {
    this.cables = [];
    this.landingPoints = [];
    this.cableMetadata = [];
    this.lastFetch = null;
    this.cacheDuration = 24 * 60 * 60 * 1000; // Cache for 24 hours
    this.isLoading = false;
    this.loadAttempted = false;
    
    // Initialize by loading data
    this.initPromise = this.loadCables();
  }

  /**
   * Load submarine cable data from Submarine Cable Map API
   */
  async loadCables() {
    // Prevent multiple simultaneous loads
    if (this.isLoading) {
      console.log('⏳ Cable data is already loading...');
      // Wait for the existing load to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    try {
      // Check if cache is still valid
      if (this.lastFetch && (Date.now() - this.lastFetch < this.cacheDuration) && this.cables.length > 0) {
        console.log(`✅ Using cached submarine cable data (${this.cables.length} cables)`);
        return;
      }

      this.isLoading = true;
      this.loadAttempted = true;
      console.log('🌊 Fetching submarine cable data from API...');

      // Fetch all three endpoints in parallel with longer timeout
      const [cableGeoResponse, landingPointResponse, cableMetadataResponse] = await Promise.all([
        axios.get('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json', { 
          timeout: 20000,
          headers: { 'Accept': 'application/json' }
        }),
        axios.get('https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json', { 
          timeout: 20000,
          headers: { 'Accept': 'application/json' }
        }),
        axios.get('https://www.submarinecablemap.com/api/v3/cable/all.json', { 
          timeout: 20000,
          headers: { 'Accept': 'application/json' }
        })
      ]);

      this.cables = cableGeoResponse.data.features || [];
      this.landingPoints = landingPointResponse.data.features || [];
      this.cableMetadata = cableMetadataResponse.data || [];
      this.lastFetch = Date.now();

      console.log(`✅ Loaded ${this.cables.length} submarine cables`);
      console.log(`✅ Loaded ${this.landingPoints.length} landing points`);
      console.log(`✅ Loaded metadata for ${this.cableMetadata.length} cables`);

      // Log a few sample cables for verification
      if (this.cables.length > 0) {
        console.log('📝 Sample cables:', this.cables.slice(0, 3).map(c => c.properties?.name));
      }

    } catch (error) {
      console.error('❌ Failed to load cable data from API:', error.message);
      if (error.response) {
        console.error('   Response status:', error.response.status);
        console.error('   Response data:', error.response.data);
      }
      
      // Keep existing data if we have it
      if (this.cables.length === 0) {
        console.warn('⚠️  No cable data available. Cable detection disabled.');
      }
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Get enriched cable metadata by matching with the metadata API
   */
  getCableMetadata(cableName) {
    if (!cableName) return null;
    
    const normalizedName = cableName.toLowerCase().trim();
    
    return this.cableMetadata.find(cable => {
      if (!cable.name) return false;
      const cableNameLower = cable.name.toLowerCase().trim();
      return cableNameLower === normalizedName ||
             cableNameLower.includes(normalizedName) ||
             normalizedName.includes(cableNameLower) ||
             cable.cable_id === cableName ||
             cable.slug === cableName;
    });
  }

  /**
   * Analyze if hops use submarine cables
   */
  async analyzeCableUsage(hops) {
    console.log('\n🔍 ========== CABLE ANALYSIS START ==========');
    
    // Ensure we have data loaded
    if (!this.loadAttempted) {
      console.log('⏳ First load - waiting for cable data...');
      await this.initPromise;
    }
    
    // If still no data, try loading again
    if (this.cables.length === 0 && !this.isLoading) {
      console.log('⚠️  No cable data found, attempting reload...');
      await this.loadCables();
    }

    // If STILL no data, return empty array
    if (this.cables.length === 0) {
      console.error('❌ No cable data available for analysis');
      console.log('🔍 ========== CABLE ANALYSIS END (NO DATA) ==========\n');
      return [];
    }

    console.log(`✅ Cable data loaded: ${this.cables.length} cables available`);

    const cablesUsed = [];
    const usedCableIds = new Set();

    console.log(`📊 Analyzing ${hops.length} hops for submarine cable usage...\n`);

    for (let i = 0; i < hops.length - 1; i++) {
      const hop1 = hops[i];
      const hop2 = hops[i + 1];

      console.log(`\n--- Analyzing Hop ${hop1.hop} → ${hop2.hop} ---`);

      if (!hop1.lat || !hop2.lat) {
        console.log(`⏭️  SKIP: Missing coordinates`);
        console.log(`   Hop ${hop1.hop}: lat=${hop1.lat}, lon=${hop1.lon}`);
        console.log(`   Hop ${hop2.hop}: lat=${hop2.lat}, lon=${hop2.lon}`);
        continue;
      }

      // Check if route crosses ocean
      const distance = this.calculateDistance(hop1.lat, hop1.lon, hop2.lat, hop2.lon);
      
      console.log(`📍 Hop ${hop1.hop}: ${hop1.city || 'Unknown'}, ${hop1.country || 'Unknown'} (${hop1.lat.toFixed(4)}, ${hop1.lon.toFixed(4)})`);
      console.log(`📍 Hop ${hop2.hop}: ${hop2.city || 'Unknown'}, ${hop2.country || 'Unknown'} (${hop2.lat.toFixed(4)}, ${hop2.lon.toFixed(4)})`);
      console.log(`📏 Distance: ${Math.round(distance)} km`);
      console.log(`🌍 Countries: ${hop1.country} → ${hop2.country}`);
      console.log(`🌊 Route type: ${hop1.routeType || 'unknown'}`);
      
      // Check multiple criteria for submarine cable detection
      const isDifferentCountry = hop1.country !== hop2.country;
      const isLongDistance = distance > 800;
      const isMarkedAsSea = hop1.routeType === 'sea';
      
      console.log(`\n🔍 Detection criteria:`);
      console.log(`   - Distance > 800km: ${isLongDistance} (${Math.round(distance)} km)`);
      console.log(`   - Different countries: ${isDifferentCountry}`);
      console.log(`   - Marked as sea route: ${isMarkedAsSea}`);
      
      // Submarine cable likely if:
      // 1. Distance > 800km AND different countries, OR
      // 2. Marked as sea route AND distance > 500km
      const isSubmarineCableRoute = (isLongDistance && isDifferentCountry) || (isMarkedAsSea && distance > 500);
      
      if (isSubmarineCableRoute) {
        console.log(`✅ SUBMARINE CABLE ROUTE DETECTED!`);
        console.log(`🔎 Searching ${this.cables.length} cables for match...`);
        
        const cable = this.findNearestCable(hop1, hop2);
        
        if (cable) {
          const cableName = cable.properties?.name || 'Unknown Cable';
          const cableId = cable.properties?.id || cable.properties?.cable_id || cableName;
          
          console.log(`\n✅ *** CABLE FOUND: ${cableName} ***`);
          
          // Only add if not already detected
          if (!usedCableIds.has(cableId)) {
            usedCableIds.add(cableId);
            
            // Get additional metadata
            const metadata = this.getCableMetadata(cableName);
            
            const cableInfo = {
              id: cableId,
              name: cableName,
              from: hop1.country,
              to: hop2.country,
              fromCity: hop1.city || 'Unknown',
              toCity: hop2.city || 'Unknown',
              hopRange: `${hop1.hop}-${hop2.hop}`,
              distance: Math.round(distance),
              length: metadata?.length || cable.properties?.length || 'N/A',
              rfs: metadata?.rfs_year || cable.properties?.rfs || 'N/A',
              owners: metadata?.owners?.[0]?.name || cable.properties?.owners || 'N/A',
              url: metadata?.url || null,
              capacity: metadata?.capacity_tbps || null
            };
            
            cablesUsed.push(cableInfo);
            
            console.log(`📋 Cable details:`, JSON.stringify(cableInfo, null, 2));
          } else {
            console.log(`⏭️  Cable ${cableName} already recorded, skipping duplicate`);
          }
        } else {
          console.log(`❌ NO CABLE FOUND within threshold`);
          console.log(`   This could mean:`);
          console.log(`   - Cable route doesn't match database geometry`);
          console.log(`   - Route uses a cable not in the database`);
          console.log(`   - Distance threshold (1000km) too restrictive`);
        }
      } else {
        console.log(`⏭️  SKIP: Not a submarine cable route`);
      }
    }

    console.log(`\n📊 ========== CABLE ANALYSIS COMPLETE ==========`);
    console.log(`✅ Found ${cablesUsed.length} unique submarine cables`);
    if (cablesUsed.length > 0) {
      console.log(`📝 Cables detected:`, cablesUsed.map(c => c.name).join(', '));
    }
    console.log('🔍 ========== CABLE ANALYSIS END ==========\n');
    
    return cablesUsed;
  }

  /**
   * Find nearest cable between two hops using point-to-line distance
   */
  findNearestCable(hop1, hop2) {
    if (this.cables.length === 0) {
      console.log('   ⚠️  No cables loaded');
      return null;
    }

    let nearestCable = null;
    let minDistance = Infinity;
    const threshold = 1000; // Increased from 500km to 1000km for better detection
    
    let cablesChecked = 0;
    let validCables = 0;

    for (const cable of this.cables) {
      cablesChecked++;
      
      // Skip if cable doesn't have valid geometry
      if (!cable.geometry || 
          cable.geometry.type !== 'LineString' || 
          !cable.geometry.coordinates ||
          cable.geometry.coordinates.length < 2) {
        continue;
      }
      
      validCables++;

      // Calculate minimum distance from hop route to cable
      const distance = this.calculateRouteProximity(
        hop1.lat, hop1.lon,
        hop2.lat, hop2.lon,
        cable.geometry.coordinates
      );

      if (distance < minDistance) {
        minDistance = distance;
        if (distance < threshold) {
          nearestCable = cable;
        }
      }
    }

    console.log(`   📊 Cables checked: ${cablesChecked}, Valid cables: ${validCables}`);
    console.log(`   🎯 Nearest cable distance: ${Math.round(minDistance)} km`);
    console.log(`   🎯 Threshold: ${threshold} km`);

    if (nearestCable) {
      console.log(`   ✅ Match found: ${nearestCable.properties?.name} (${Math.round(minDistance)} km away)`);
    } else {
      console.log(`   ❌ No cable within ${threshold}km threshold`);
      if (minDistance < Infinity) {
        console.log(`   ℹ️  Closest cable was ${Math.round(minDistance)} km away`);
      }
    }

    return nearestCable;
  }

  /**
   * Calculate proximity between a hop route and a cable line
   */
  calculateRouteProximity(lat1, lon1, lat2, lon2, cableCoordinates) {
    // Calculate midpoint of the hop route
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;

    // Also check endpoints
    let minDist = Infinity;

    // Check distance from route midpoint to cable
    for (let i = 0; i < cableCoordinates.length - 1; i++) {
      const cableLon1 = cableCoordinates[i][0];
      const cableLat1 = cableCoordinates[i][1];
      const cableLon2 = cableCoordinates[i + 1][0];
      const cableLat2 = cableCoordinates[i + 1][1];

      // Distance from hop midpoint to cable segment
      const distMid = this.pointToSegmentDistance(
        midLat, midLon,
        cableLat1, cableLon1,
        cableLat2, cableLon2
      );

      // Distance from hop start point to cable segment
      const distStart = this.pointToSegmentDistance(
        lat1, lon1,
        cableLat1, cableLon1,
        cableLat2, cableLon2
      );

      // Distance from hop end point to cable segment
      const distEnd = this.pointToSegmentDistance(
        lat2, lon2,
        cableLat1, cableLon1,
        cableLat2, cableLon2
      );

      minDist = Math.min(minDist, distMid, distStart, distEnd);
    }

    return minDist;
  }

  /**
   * Calculate distance from a point to a line segment
   */
  pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon) {
    const distPA = this.calculateDistance(pLat, pLon, aLat, aLon);
    const distPB = this.calculateDistance(pLat, pLon, bLat, bLon);
    const distAB = this.calculateDistance(aLat, aLon, bLat, bLon);

    // If segment is very short, return distance to nearest endpoint
    if (distAB < 1) {
      return Math.min(distPA, distPB);
    }

    // Calculate perpendicular distance using Heron's formula
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
   * Get cable details by ID or name
   */
  getCableById(cableId) {
    return this.cables.find(cable => 
      cable.properties?.cable_id === cableId || 
      cable.properties?.id === cableId ||
      cable.properties?.name === cableId
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

  /**
   * Find landing points near a coordinate
   */
  findNearbyLandingPoints(lat, lon, radiusKm = 200) {
    return this.landingPoints.filter(point => {
      if (!point.geometry?.coordinates) return false;
      
      const [pLon, pLat] = point.geometry.coordinates;
      const distance = this.calculateDistance(lat, lon, pLat, pLon);
      
      return distance <= radiusKm;
    }).map(point => ({
      name: point.properties?.name,
      city: point.properties?.city,
      country: point.properties?.country,
      coordinates: point.geometry.coordinates,
      distance: this.calculateDistance(lat, lon, point.geometry.coordinates[1], point.geometry.coordinates[0])
    }));
  }

  /**
   * Refresh cable data (force reload)
   */
  async refreshData() {
    console.log('🔄 Forcing cable data refresh...');
    this.lastFetch = null;
    this.cables = [];
    this.landingPoints = [];
    this.cableMetadata = [];
    await this.loadCables();
  }
}

module.exports = new CableService();

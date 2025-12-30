const axios = require('axios');

class CableService {
  
  constructor() {
    this.cables = [];
    this.landingPoints = [];
    this.cableMetadata = [];
    this.lastFetch = null;
    this.cacheDuration = 24 * 60 * 60 * 1000;
    this.isLoading = false;
    this.loadAttempted = false;
    
    this.initPromise = this.loadCables();
  }

  async loadCables() {
    if (this.isLoading) {
      console.log('⏳ Cable data is already loading...');
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    try {
      if (this.lastFetch && (Date.now() - this.lastFetch < this.cacheDuration) && this.cables.length > 0) {
        console.log(`✅ Using cached submarine cable data (${this.cables.length} cables)`);
        return;
      }

      this.isLoading = true;
      this.loadAttempted = true;
      console.log('🌊 Fetching submarine cable data from API...');

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

      if (this.cables.length > 0) {
        console.log('📝 Sample cables:', this.cables.slice(0, 3).map(c => c.properties?.name));
      }

    } catch (error) {
      console.error('❌ Failed to load cable data from API:', error.message);
      if (error.response) {
        console.error('   Response status:', error.response.status);
      }
      
      if (this.cables.length === 0) {
        console.warn('⚠️  No cable data available. Cable detection disabled.');
      }
    } finally {
      this.isLoading = false;
    }
  }

  getCableMetadata(cableId) {
    if (!cableId) return null;
    
    const normalizedId = cableId.toLowerCase().trim();
    
    return this.cableMetadata.find(cable => {
      if (!cable.cable_id && !cable.slug && !cable.name) return false;
      
      const id = (cable.cable_id || cable.slug || '').toLowerCase().trim();
      const name = (cable.name || '').toLowerCase().trim();
      
      return id === normalizedId || 
             name === normalizedId ||
             id.includes(normalizedId) ||
             normalizedId.includes(id);
    });
  }

  /**
   * Check if a route is a valid submarine cable route
   * Returns true only if the route crosses water AND matches a cable
   */
  isSubmarineCableRoute(hop1, hop2, distance) {
    // Skip if either hop has no coordinates
    if (!hop1.lat || !hop2.lat || !hop1.country || !hop2.country) {
      return false;
    }

    // CRITICAL: Routes within the same country are LAND routes (except for special cases)
    if (hop1.country === hop2.country) {
      // Exception: Very long distances within large countries that cross water
      // (e.g., US mainland to Hawaii, Indonesia between islands)
      const largCountries = ['US', 'ID', 'PH', 'MY', 'JP'];
      
      if (!largCountries.includes(hop1.country) || distance < 1000) {
        console.log(`   ⛔ SAME COUNTRY (${hop1.country}), distance ${Math.round(distance)}km - LAND ROUTE`);
        return false;
      }
    }

    // Must have significant distance (minimum 500km for intercontinental)
    if (distance < 500) {
      console.log(`   ⛔ Short distance (${Math.round(distance)}km) - LAND ROUTE`);
      return false;
    }

    // Check if countries are on different continents or separated by ocean
    const crossesOcean = this.routeCrossesOcean(hop1, hop2);
    
    if (!crossesOcean) {
      console.log(`   ⛔ Does not cross ocean - LAND ROUTE`);
      return false;
    }

    return true;
  }

  /**
   * Determine if route crosses an ocean (requires submarine cable)
   */
  routeCrossesOcean(hop1, hop2) {
    const continent1 = this.getContinent(hop1.country);
    const continent2 = this.getContinent(hop2.country);

    // Different continents = likely ocean crossing
    if (continent1 !== continent2) {
      // Special case: Europe to Asia via land is possible
      if ((continent1 === 'Europe' && continent2 === 'Asia') ||
          (continent1 === 'Asia' && continent2 === 'Europe')) {
        // Check if route goes through Russia/Turkey (land) or crosses Mediterranean/Atlantic (sea)
        const avgLat = (hop1.lat + hop2.lat) / 2;
        const avgLon = (hop1.lon + hop2.lon) / 2;
        
        // If route is in northern latitudes (>40°) and eastern hemisphere, likely land
        if (avgLat > 40 && avgLon > 30 && avgLon < 180) {
          return false; // Trans-Siberian route
        }
      }
      
      console.log(`   🌊 Different continents: ${continent1} → ${continent2}`);
      return true;
    }

    // Same continent but check for specific ocean-separated countries
    const oceanSeparated = this.areCountriesOceanSeparated(hop1.country, hop2.country);
    if (oceanSeparated) {
      console.log(`   🌊 Ocean-separated countries: ${hop1.country} → ${hop2.country}`);
      return true;
    }

    return false;
  }

  /**
   * Map country codes to continents
   */
  getContinent(countryCode) {
    const continentMap = {
      // North America
      'US': 'North America', 'CA': 'North America', 'MX': 'North America',
      'GT': 'North America', 'BZ': 'North America', 'SV': 'North America',
      'HN': 'North America', 'NI': 'North America', 'CR': 'North America',
      'PA': 'North America', 'CU': 'North America', 'JM': 'North America',
      
      // South America
      'BR': 'South America', 'AR': 'South America', 'CL': 'South America',
      'CO': 'South America', 'VE': 'South America', 'PE': 'South America',
      'EC': 'South America', 'BO': 'South America', 'PY': 'South America',
      'UY': 'South America', 'GY': 'South America', 'SR': 'South America',
      
      // Europe
      'GB': 'Europe', 'FR': 'Europe', 'DE': 'Europe', 'IT': 'Europe',
      'ES': 'Europe', 'PT': 'Europe', 'NL': 'Europe', 'BE': 'Europe',
      'SE': 'Europe', 'NO': 'Europe', 'DK': 'Europe', 'FI': 'Europe',
      'PL': 'Europe', 'CZ': 'Europe', 'AT': 'Europe', 'CH': 'Europe',
      'IE': 'Europe', 'GR': 'Europe', 'RO': 'Europe', 'HU': 'Europe',
      
      // Asia
      'CN': 'Asia', 'JP': 'Asia', 'IN': 'Asia', 'KR': 'Asia',
      'TH': 'Asia', 'VN': 'Asia', 'MY': 'Asia', 'SG': 'Asia',
      'ID': 'Asia', 'PH': 'Asia', 'PK': 'Asia', 'BD': 'Asia',
      'IR': 'Asia', 'IQ': 'Asia', 'SA': 'Asia', 'AE': 'Asia',
      'TR': 'Asia', 'IL': 'Asia', 'TW': 'Asia', 'HK': 'Asia',
      
      // Africa
      'ZA': 'Africa', 'EG': 'Africa', 'NG': 'Africa', 'KE': 'Africa',
      'MA': 'Africa', 'DZ': 'Africa', 'TN': 'Africa', 'LY': 'Africa',
      'ET': 'Africa', 'GH': 'Africa', 'CI': 'Africa', 'CM': 'Africa',
      
      // Oceania
      'AU': 'Oceania', 'NZ': 'Oceania', 'FJ': 'Oceania', 'PG': 'Oceania',
    };

    return continentMap[countryCode] || 'Unknown';
  }

  /**
   * Check if two countries are separated by ocean despite being on same continent
   */
  areCountriesOceanSeparated(country1, country2) {
    // Islands separated from mainland
    const oceanSeparatedPairs = [
      // UK to/from Europe mainland
      ['GB', 'FR'], ['GB', 'DE'], ['GB', 'NL'], ['GB', 'BE'],
      ['GB', 'ES'], ['GB', 'IT'], ['GB', 'IE'],
      
      // Japan to/from Asia mainland
      ['JP', 'CN'], ['JP', 'KR'], ['JP', 'RU'],
      
      // Indonesia islands
      ['ID', 'SG'], ['ID', 'MY'], ['ID', 'AU'],
      
      // Philippines
      ['PH', 'CN'], ['PH', 'TW'], ['PH', 'JP'],
      
      // Australia/NZ to Asia
      ['AU', 'SG'], ['AU', 'ID'], ['NZ', 'AU'],
      
      // Iceland
      ['IS', 'GB'], ['IS', 'NO'], ['IS', 'US'],
    ];

    // Check both directions
    return oceanSeparatedPairs.some(pair => 
      (pair[0] === country1 && pair[1] === country2) ||
      (pair[0] === country2 && pair[1] === country1)
    );
  }

  /**
   * Find cable that matches this route
   */
  findMatchingCable(lat1, lon1, lat2, lon2) {
    const threshold = 200; // Stricter threshold - 200km
    let bestMatch = null;
    let minDistance = Infinity;

    for (const cable of this.cables) {
      if (!cable.geometry || !cable.geometry.coordinates) continue;
      
      const coordinates = cable.geometry.type === 'MultiLineString' 
        ? cable.geometry.coordinates[0] 
        : cable.geometry.coordinates;
      
      if (!coordinates || coordinates.length < 2) continue;

      const distance = this.calculateRouteProximity(lat1, lon1, lat2, lon2, coordinates);
      
      if (distance < minDistance && distance < threshold) {
        minDistance = distance;
        bestMatch = { cable, distance };
      }
    }

    return bestMatch;
  }

  async analyzeCableUsage(hops) {
    console.log('\n🔍 ========== CABLE ANALYSIS START ==========');
    
    if (!this.loadAttempted) {
      console.log('⏳ First load - waiting for cable data...');
      await this.initPromise;
    }
    
    if (this.cables.length === 0 && !this.isLoading) {
      console.log('⚠️  No cable data found, attempting reload...');
      await this.loadCables();
    }

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
        hop1.routeType = 'land';
        continue;
      }

      const distance = this.calculateDistance(hop1.lat, hop1.lon, hop2.lat, hop2.lon);
      
      console.log(`📍 Hop ${hop1.hop}: ${hop1.city || 'Unknown'}, ${hop1.country || 'Unknown'}`);
      console.log(`📍 Hop ${hop2.hop}: ${hop2.city || 'Unknown'}, ${hop2.country || 'Unknown'}`);
      console.log(`📏 Distance: ${Math.round(distance)} km`);
      
      // Step 1: Check if this COULD be a submarine cable route
      const couldBeSubmarineCable = this.isSubmarineCableRoute(hop1, hop2, distance);
      
      if (!couldBeSubmarineCable) {
        hop1.routeType = 'land';
        console.log(`✅ Classified as: LAND ROUTE`);
        continue;
      }
      
      // Step 2: If it could be submarine, try to find matching cable
      console.log(`🔎 Could be submarine cable - searching for match...`);
      const cableMatch = this.findMatchingCable(hop1.lat, hop1.lon, hop2.lat, hop2.lon);
      
      if (cableMatch) {
        const cable = cableMatch.cable;
        const cableId = cable.properties?.id || cable.properties?.cable_id;
        const cableName = cable.properties?.name || 'Unknown Cable';
        
        console.log(`✅ *** SUBMARINE CABLE CONFIRMED: ${cableName} ***`);
        console.log(`   Distance to cable: ${Math.round(cableMatch.distance)} km`);
        
        hop1.routeType = 'sea';
        hop1.cableUsed = cableName;
        
        if (!usedCableIds.has(cableId)) {
          usedCableIds.add(cableId);
          
          const metadata = this.getCableMetadata(cableId);
          
          const cableInfo = {
            id: cableId,
            name: cableName,
            from: hop1.country,
            to: hop2.country,
            fromCity: hop1.city || 'Unknown',
            toCity: hop2.city || 'Unknown',
            hopRange: `${hop1.hop}-${hop2.hop}`,
            distance: Math.round(distance),
            length: metadata?.length || 'N/A',
            rfs: metadata?.ready_for_service || metadata?.rfs || 'N/A',
            owners: this.extractOwners(metadata),
            url: metadata?.url || `https://www.submarinecablemap.com/submarine-cable/${cableId}`,
            color: cable.properties?.color || '#939597'
          };
          
          cablesUsed.push(cableInfo);
          console.log(`📋 Cable details:`, JSON.stringify(cableInfo, null, 2));
        } else {
          console.log(`⏭️  Cable ${cableName} already recorded`);
        }
      } else {
        // Ocean crossing but no cable found - likely using a cable not in database
        hop1.routeType = 'sea';
        hop1.cableUsed = 'Unknown Cable';
        console.log(`⚠️  Ocean crossing detected but no cable match found in database`);
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

  extractOwners(metadata) {
    if (!metadata) return 'N/A';
    
    if (metadata.owners && Array.isArray(metadata.owners)) {
      return metadata.owners.slice(0, 3).map(o => o.name || o).join(', ');
    }
    
    if (metadata.owner) return metadata.owner;
    
    return 'N/A';
  }

  calculateRouteProximity(lat1, lon1, lat2, lon2, cableCoordinates) {
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;

    let minDist = Infinity;

    for (let i = 0; i < cableCoordinates.length - 1; i++) {
      const cableLon1 = cableCoordinates[i][0];
      const cableLat1 = cableCoordinates[i][1];
      const cableLon2 = cableCoordinates[i + 1][0];
      const cableLat2 = cableCoordinates[i + 1][1];

      const distMid = this.pointToSegmentDistance(
        midLat, midLon, cableLat1, cableLon1, cableLat2, cableLon2
      );

      const distStart = this.pointToSegmentDistance(
        lat1, lon1, cableLat1, cableLon1, cableLat2, cableLon2
      );

      const distEnd = this.pointToSegmentDistance(
        lat2, lon2, cableLat1, cableLon1, cableLat2, cableLon2
      );

      minDist = Math.min(minDist, distMid, distStart, distEnd);
    }

    return minDist;
  }

  pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon) {
    const distPA = this.calculateDistance(pLat, pLon, aLat, aLon);
    const distPB = this.calculateDistance(pLat, pLon, bLat, bLon);
    const distAB = this.calculateDistance(aLat, aLon, bLat, bLon);

    if (distAB < 1) return Math.min(distPA, distPB);

    const s = (distPA + distPB + distAB) / 2;
    const area = Math.sqrt(Math.max(0, s * (s - distPA) * (s - distPB) * (s - distAB)));
    const perpDist = (2 * area) / distAB;

    const dotProduct = 
      ((pLat - aLat) * (bLat - aLat) + (pLon - aLon) * (bLon - aLon)) /
      (distAB * distAB);

    if (dotProduct < 0) return distPA;
    if (dotProduct > 1) return distPB;
    return perpDist;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
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
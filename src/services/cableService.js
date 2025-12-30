const fs = require('fs');
const path = require('path');

class CableService {
  
  constructor() {
    this.cables = this.loadCables();
  }

  /**
   * Load submarine cable data
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

    for (let i = 0; i < hops.length - 1; i++) {
      const hop1 = hops[i];
      const hop2 = hops[i + 1];

      if (!hop1.lat || !hop2.lat) continue;

      // Check if route crosses ocean
      const distance = this.calculateDistance(hop1.lat, hop1.lon, hop2.lat, hop2.lon);
      
      if (distance > 800 && hop1.country !== hop2.country) {
        // Likely submarine cable
        const cable = this.findNearestCable(hop1, hop2);
        
        if (cable) {
          cablesUsed.push({
            name: cable.properties?.name || 'Unknown Cable',
            from: hop1.country,
            to: hop2.country,
            hopRange: `${hop1.hop}-${hop2.hop}`
          });
        }
      }
    }

    return cablesUsed;
  }

  /**
   * Find nearest cable between two points
   */
  findNearestCable(hop1, hop2) {
    // Simplified: return first cable (full implementation would calculate proximity)
    if (this.cables.length > 0) {
      return this.cables[0];
    }
    return null;
  }

  /**
   * Calculate distance between coordinates
   */
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
}

module.exports = new CableService();
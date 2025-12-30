/**
 * Utility functions for distance and time calculations
 */

class Calculations {
  
    /**
     * Haversine distance between two coordinates
     */
    static haversineDistance(lat1, lon1, lat2, lon2) {
      const R = 6371; // Earth radius in km
      const dLat = this.toRadians(lat2 - lat1);
      const dLon = this.toRadians(lon2 - lon1);
  
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }
  
    static toRadians(degrees) {
      return degrees * (Math.PI / 180);
    }
  
    /**
     * Format time from milliseconds to readable format
     */
    static formatTime(ms) {
      if (ms < 1) return `${(ms * 1000).toFixed(2)} μs`;
      if (ms < 1000) return `${ms.toFixed(2)} ms`;
      return `${(ms / 1000).toFixed(2)} s`;
    }
  
    /**
     * Format distance with units
     */
    static formatDistance(km) {
      if (km < 1) return `${(km * 1000).toFixed(0)} m`;
      return `${km.toFixed(2)} km`;
    }
  }
  
  module.exports = Calculations;
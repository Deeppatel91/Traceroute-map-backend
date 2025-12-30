const geoip = require('geoip-lite');

class GeoService {
  
  /**
   * Get geolocation for an IP address
   */
  getGeoLocation(ip) {
    const geo = geoip.lookup(ip);

    if (!geo) {
      return {
        lat: null,
        lon: null,
        city: 'Unknown',
        country: 'Unknown',
        countryCode: 'XX'
      };
    }

    return {
      lat: geo.ll[0],
      lon: geo.ll[1],
      city: geo.city || 'Unknown',
      country: geo.country,
      countryCode: geo.country,
      timezone: geo.timezone
    };
  }

  /**
   * Check if two points are on different continents
   */
  isDifferentContinent(country1, country2) {
    const continents = {
      'US': 'North America',
      'CA': 'North America',
      'MX': 'North America',
      'GB': 'Europe',
      'DE': 'Europe',
      'FR': 'Europe',
      'CN': 'Asia',
      'JP': 'Asia',
      'IN': 'Asia',
      'BR': 'South America',
      'AU': 'Oceania'
    };

    return continents[country1] !== continents[country2];
  }
}

module.exports = new GeoService();
const geoip = require('geoip-lite');

class GeoService {
  /**
   * Get geolocation for an IP address
   */
  getGeoLocation(ip) {
    if (!ip) {
      return {
        lat: null,
        lon: null,
        city: 'Unknown',
        country: 'Unknown',
        countryCode: 'XX',
        timezone: null
      };
    }

    const geo = geoip.lookup(ip);

    if (!geo) {
      return {
        lat: null,
        lon: null,
        city: 'Unknown',
        country: 'Unknown',
        countryCode: 'XX',
        timezone: null
      };
    }

    return {
      lat: geo.ll ? geo.ll[0] : null,
      lon: geo.ll ? geo.ll[1] : null,
      city: geo.city || 'Unknown',
      country: geo.country || 'Unknown',
      countryCode: geo.country || 'XX',
      timezone: geo.timezone || null
    };
  }

  /**
   * Very rough continent check by country code
   */
  isDifferentContinent(country1, country2) {
    if (!country1 || !country2) return false;

    const continents = {
      US: 'North America',
      CA: 'North America',
      MX: 'North America',
      GB: 'Europe',
      DE: 'Europe',
      FR: 'Europe',
      ES: 'Europe',
      IT: 'Europe',
      NL: 'Europe',
      BE: 'Europe',
      SE: 'Europe',
      NO: 'Europe',
      FI: 'Europe',
      PL: 'Europe',
      CN: 'Asia',
      JP: 'Asia',
      IN: 'Asia',
      SG: 'Asia',
      HK: 'Asia',
      LK: 'Asia',
      BR: 'South America',
      AR: 'South America',
      CL: 'South America',
      AU: 'Oceania',
      NZ: 'Oceania',
      ZA: 'Africa',
      NG: 'Africa',
      EG: 'Africa'
    };

    const c1 = continents[country1] || null;
    const c2 = continents[country2] || null;

    if (!c1 || !c2) return false;
    return c1 !== c2;
  }
}

module.exports = new GeoService();

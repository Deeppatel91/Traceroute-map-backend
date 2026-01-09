const dns = require("dns").promises;
const axios = require("axios");

class GeoService {
  constructor() {
    this.cache = new Map();
    this.TTL = 1000 * 60 * 60 * 24; // 24 hours
  }

  /**
   * Main geolocation resolver
   */
  async getGeoLocation(ip) {
    if (!ip) return this.empty();

    // Cache
    if (this.cache.has(ip)) {
      const cached = this.cache.get(ip);
      if (Date.now() - cached.timestamp < this.TTL) return cached.data;
    }

    // Private IP
    if (this.isPrivateIP(ip)) {
      const data = {
        lat: null,
        lon: null,
        city: "Private Network",
        country: "Local",
        countryCode: "XX",
        timezone: null,
        rdns: null
      };
      this.cache.set(ip, { data, timestamp: Date.now() });
      return data;
    }

    // Reverse DNS (POP detection)
    let rdns = null;
    try {
      const ptr = await dns.reverse(ip);
      rdns = ptr[0] || null;
    } catch {}

    // Primary API (ip-api.com)
    try {
      const res = await axios.get(
        `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,lat,lon,timezone`,
        { timeout: 5000 }
      );

      if (res.data.status === "success") {
        const data = {
          lat: res.data.lat,
          lon: res.data.lon,
          city: res.data.city || "Unknown",
          country: res.data.country || "Unknown",
          countryCode: res.data.countryCode || "XX",
          timezone: res.data.timezone || null,
          rdns
        };

        this.cache.set(ip, { data, timestamp: Date.now() });
        return data;
      }
    } catch {}

    // Fallback
    const fallback = this.empty();
    fallback.rdns = rdns;
    this.cache.set(ip, { data: fallback, timestamp: Date.now() });
    return fallback;
  }

  empty() {
    return {
      lat: null,
      lon: null,
      city: "Unknown",
      country: "Unknown",
      countryCode: "XX",
      timezone: null,
      rdns: null
    };
  }

  isPrivateIP(ip) {
    return (
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
      /^127\./.test(ip)
    );
  }

  isDifferentContinent(c1, c2) {
    const map = {
      NA: ["US", "CA", "MX"],
      EU: ["GB", "DE", "FR", "NL", "SE", "NO", "FI", "PL", "IT", "ES", "BE"],
      AS: ["CN", "JP", "IN", "SG", "HK", "LK"],
      SA: ["BR", "AR", "CL"],
      OC: ["AU", "NZ"],
      AF: ["ZA", "NG", "EG"]
    };

    const cont1 = Object.keys(map).find(k => map[k].includes(c1));
    const cont2 = Object.keys(map).find(k => map[k].includes(c2));

    return cont1 && cont2 && cont1 !== cont2;
  }
}

module.exports = new GeoService();

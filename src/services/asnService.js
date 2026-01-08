const axios = require('axios');

class ASNService {
  constructor() {
    // Known CDN ASNs
    this.cdnAsns = {
      AS13335: 'Cloudflare',
      AS16509: 'Amazon AWS',
      AS15169: 'Google Cloud',
      AS8075: 'Microsoft Azure',
      AS20940: 'Akamai',
      AS16625: 'Akamai',
      AS14618: 'Amazon CloudFront',
      AS32934: 'Facebook',
      AS54113: 'Fastly',
      AS45102: 'Alibaba Cloud'
    };

    this.cache = new Map();
  }

  /**
   * Get ASN information for an IP (API-based, Windows-friendly)
   */
  async getASN(ip) {
    try {
      if (!ip) {
        return {
          asn: 'Unknown',
          org: 'Unknown',
          isCdn: false,
          cdnProvider: null,
          country: 'Unknown'
        };
      }

      if (this.cache.has(ip)) {
        return this.cache.get(ip);
      }

      if (this.isPrivateIP(ip)) {
        const result = {
          asn: 'Private',
          org: 'Private Network',
          isCdn: false,
          cdnProvider: null,
          country: 'Local'
        };
        this.cache.set(ip, result);
        return result;
      }

      let result =
        (await this.tryIPApiCom(ip)) ||
        (await this.tryIPInfo(ip)) ||
        (await this.tryIPAPI(ip));

      if (!result) {
        result = {
          asn: 'Unknown',
          org: 'Unknown',
          isCdn: false,
          cdnProvider: null,
          country: 'Unknown'
        };
      }

      this.cache.set(ip, result);
      return result;
    } catch (error) {
      console.error(`ASN lookup failed for ${ip}:`, error.message);
      return {
        asn: 'Unknown',
        org: 'Unknown',
        isCdn: false,
        cdnProvider: null,
        country: 'Unknown'
      };
    }
  }

  /**
   * ip-api.com
   */
  async tryIPApiCom(ip) {
    try {
      const response = await axios.get(
        `http://ip-api.com/json/${ip}?fields=as,org,country`,
        { timeout: 5000 }
      );

      if (response.data && response.data.as) {
        const asMatch = response.data.as.match(/AS(\d+)/i);
        const asn = asMatch ? `AS${asMatch[1]}` : 'Unknown';
        const org = response.data.org || 'Unknown';
        const isCdn = this.isCdnAsn(asn);
        const cdnProvider = isCdn ? this.cdnAsns[asn] : null;

        return {
          asn,
          org,
          isCdn,
          cdnProvider,
          country: response.data.country || 'Unknown'
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * ipinfo.io
   */
  async tryIPInfo(ip) {
    try {
      const token = process.env.IPINFO_TOKEN || '';
      const url = token
        ? `https://ipinfo.io/${ip}?token=${token}`
        : `https://ipinfo.io/${ip}`;

      const response = await axios.get(url, { timeout: 5000 });

      if (response.data && response.data.org) {
        const asMatch = response.data.org.match(/AS(\d+)/i);
        const asn = asMatch ? `AS${asMatch[1]}` : 'Unknown';
        const org = response.data.org.replace(/AS\d+\s*/i, '').trim() || 'Unknown';
        const isCdn = this.isCdnAsn(asn);
        const cdnProvider = isCdn ? this.cdnAsns[asn] : null;

        return {
          asn,
          org,
          isCdn,
          cdnProvider,
          country: response.data.country || 'Unknown'
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * ipapi.co
   */
  async tryIPAPI(ip) {
    try {
      const response = await axios.get(`https://ipapi.co/${ip}/json/`, {
        timeout: 5000
      });

      if (response.data && response.data.asn) {
        const asn = `AS${response.data.asn}`;
        const org = response.data.org || response.data.org_name || 'Unknown';
        const isCdn = this.isCdnAsn(asn);
        const cdnProvider = isCdn ? this.cdnAsns[asn] : null;

        return {
          asn,
          org,
          isCdn,
          cdnProvider,
          country: response.data.country_name || 'Unknown'
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if IP is private/local
   */
  isPrivateIP(ip) {
    if (!ip) return false;
    if (!ip.match(/^\d+\.\d+\.\d+\.\d+$/)) return false;

    const parts = ip.split('.').map(Number);

    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;

    return false;
  }

  /**
   * Check if ASN belongs to a CDN
   */
  isCdnAsn(asn) {
    return !!this.cdnAsns[asn];
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new ASNService();

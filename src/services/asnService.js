const axios = require('axios');

class ASNService {
  
  constructor() {
    // Known CDN ASNs
    this.cdnAsns = {
      'AS13335': 'Cloudflare',
      'AS16509': 'Amazon AWS',
      'AS15169': 'Google Cloud',
      'AS8075': 'Microsoft Azure',
      'AS20940': 'Akamai',
      'AS16625': 'Akamai',
      'AS14618': 'Amazon CloudFront',
      'AS32934': 'Facebook',
      'AS54113': 'Fastly',
      'AS45102': 'Alibaba Cloud'
    };

    // Cache to avoid repeated API calls
    this.cache = new Map();
  }

  /**
   * Get ASN information for an IP (Windows compatible)
   * Uses free API instead of whois command
   */
  async getASN(ip) {
    try {
      // Check cache first
      if (this.cache.has(ip)) {
        return this.cache.get(ip);
      }

      // Skip private IPs
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

      // Try multiple free APIs in order
      let result = await this.tryIPApiCom(ip);
      
      if (!result) {
        result = await this.tryIPInfo(ip);
      }

      if (!result) {
        result = await this.tryIPAPI(ip);
      }

      if (!result) {
        // Fallback
        result = {
          asn: 'Unknown',
          org: 'Unknown',
          isCdn: false,
          cdnProvider: null,
          country: 'Unknown'
        };
      }

      // Cache the result
      this.cache.set(ip, result);
      return result;

    } catch (error) {
      console.error(`ASN lookup failed for ${ip}:`, error.message);
      return {
        asn: 'Unknown',
        org: 'Unknown',
        isCdn: false,
        cdnProvider: null
      };
    }
  }

  /**
   * Try ip-api.com (Free, no key required, 45 req/min)
   */
  async tryIPApiCom(ip) {
    try {
      const response = await axios.get(`http://ip-api.com/json/${ip}?fields=as,org,country`, {
        timeout: 5000
      });

      if (response.data && response.data.as) {
        const asMatch = response.data.as.match(/AS(\d+)/);
        const asn = asMatch ? `AS${asMatch[1]}` : 'Unknown';
        const org = response.data.org || 'Unknown';
        
        const isCdn = this.cdnAsns.hasOwnProperty(asn);
        const cdnProvider = isCdn ? this.cdnAsns[asn] : null;

        return {
          asn: asn,
          org: org,
          isCdn: isCdn,
          cdnProvider: cdnProvider,
          country: response.data.country || 'Unknown'
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Try ipinfo.io (Free, 50k req/month with free token)
   */
  async tryIPInfo(ip) {
    try {
      const token = process.env.IPINFO_TOKEN || '';
      const url = token 
        ? `https://ipinfo.io/${ip}?token=${token}`
        : `https://ipinfo.io/${ip}`;

      const response = await axios.get(url, { timeout: 5000 });

      if (response.data && response.data.org) {
        const asMatch = response.data.org.match(/AS(\d+)/);
        const asn = asMatch ? `AS${asMatch[1]}` : 'Unknown';
        const org = response.data.org.replace(/AS\d+\s*/, '');
        
        const isCdn = this.cdnAsns.hasOwnProperty(asn);
        const cdnProvider = isCdn ? this.cdnAsns[asn] : null;

        return {
          asn: asn,
          org: org,
          isCdn: isCdn,
          cdnProvider: cdnProvider,
          country: response.data.country || 'Unknown'
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Try ipapi.co (Free, 1000 req/day)
   */
  async tryIPAPI(ip) {
    try {
      const response = await axios.get(`https://ipapi.co/${ip}/json/`, { 
        timeout: 5000 
      });

      if (response.data && response.data.asn) {
        const asn = `AS${response.data.asn}`;
        const org = response.data.org || 'Unknown';
        
        const isCdn = this.cdnAsns.hasOwnProperty(asn);
        const cdnProvider = isCdn ? this.cdnAsns[asn] : null;

        return {
          asn: asn,
          org: org,
          isCdn: isCdn,
          cdnProvider: cdnProvider,
          country: response.data.country_name || 'Unknown'
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if IP is private/local
   */
  isPrivateIP(ip) {
    const parts = ip.split('.').map(Number);
    
    // 10.0.0.0 - 10.255.255.255
    if (parts[0] === 10) return true;
    
    // 172.16.0.0 - 172.31.255.255
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    
    // 192.168.0.0 - 192.168.255.255
    if (parts[0] === 192 && parts[1] === 168) return true;
    
    // 127.0.0.0 - 127.255.255.255 (localhost)
    if (parts[0] === 127) return true;
    
    return false;
  }

  /**
   * Check if ASN belongs to a CDN
   */
  isCdnAsn(asn) {
    return this.cdnAsns.hasOwnProperty(asn);
  }

  /**
   * Clear cache (for testing)
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new ASNService();
const axios = require("axios");

class ASNService {
  constructor() {
    this.cache = new Map();
    this.TTL = 1000 * 60 * 60 * 24; // 24 hours

    this.cdnAsns = {
      13335: "Cloudflare",
      20940: "Akamai",
      16625: "Akamai",
      54113: "Fastly",
      15169: "Google",
      16509: "Amazon AWS",
      14618: "Amazon CloudFront",
      8075: "Microsoft Azure",
      45102: "Alibaba Cloud",
      63949: "Linode / Akamai Connected Cloud"
    };
  }

  async getASN(ip) {
    if (!ip) return this.empty();

    // Cache
    if (this.cache.has(ip)) {
      const cached = this.cache.get(ip);
      if (Date.now() - cached.timestamp < this.TTL) return cached.data;
    }

    // Private IP
    if (this.isPrivateIP(ip)) {
      const data = {
        asn: null,
        asnNumber: null,
        org: "Private Network",
        country: "Local",
        isCdn: false,
        cdnProvider: null
      };
      this.cache.set(ip, { data, timestamp: Date.now() });
      return data;
    }

    // Primary API
    try {
      const res = await axios.get(
        `http://ip-api.com/json/${ip}?fields=as,org,country`,
        { timeout: 5000 }
      );

      if (res.data.as) {
        const asnNumber = parseInt(res.data.as.replace("AS", ""));
        const org = res.data.org || "Unknown";
        const country = res.data.country || "Unknown";

        const isCdn = this.cdnAsns[asnNumber] ? true : false;
        const cdnProvider = this.cdnAsns[asnNumber] || null;

        const data = {
          asn: `AS${asnNumber}`,
          asnNumber,
          org,
          country,
          isCdn,
          cdnProvider
        };

        this.cache.set(ip, { data, timestamp: Date.now() });
        return data;
      }
    } catch {}

    // Fallback
    const fallback = this.empty();
    this.cache.set(ip, { data: fallback, timestamp: Date.now() });
    return fallback;
  }

  empty() {
    return {
      asn: null,
      asnNumber: null,
      org: "Unknown",
      country: "Unknown",
      isCdn: false,
      cdnProvider: null
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
}

module.exports = new ASNService();

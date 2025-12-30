const { exec } = require('child_process');
const { promisify } = require('util');
const dns = require('dns').promises;
const execAsync = promisify(exec);
const geoService = require('./geoService');
const asnService = require('./asnService');
const cableService = require('./cableService');
const os = require('os');

class TracerouteService {
  
  constructor() {
    this.isWindows = os.platform() === 'win32';
    console.log(`🖥️  Platform: ${this.isWindows ? 'Windows' : 'Unix/Linux'}`);
  }

  /**
   * Main traceroute function
   */
  async traceRoute(domain) {
    try {
      const targetIp = await this.resolveDomain(domain);
      
      if (!targetIp) {
        return { error: 'Could not resolve domain' };
      }

      console.log(`✅ Resolved ${domain} → ${targetIp}`);

      const hops = await this.runTraceroute(targetIp);

      if (!hops || hops.length === 0) {
        return { error: 'Traceroute failed - no hops returned' };
      }

      console.log(`✅ Found ${hops.length} hops`);

      // Enrich each hop with geo + ASN data
      const enrichedHops = await this.enrichHops(hops);

      // Analyze submarine cables - this will also set routeType for each hop
      const cableInfo = await cableService.analyzeCableUsage(enrichedHops);

      // Calculate distances AFTER cable analysis (so we have routeType set)
      const distances = this.calculateDistances(enrichedHops);

      // Detect CDN/Cloudflare
      const cdnInfo = this.detectCDN(enrichedHops);

      // Calculate total time
      const totalTime = this.calculateTotalTime(enrichedHops);

      return {
        success: true,
        domain: domain,
        targetIp: targetIp,
        totalHops: enrichedHops.length,
        totalDistance: distances.total,
        landDistance: distances.land,
        seaDistance: distances.sea,
        totalTime: totalTime,
        hasCdn: cdnInfo.detected,
        cdnProvider: cdnInfo.provider,
        hops: enrichedHops,
        cables: cableInfo,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Traceroute error:', error);
      return { error: error.message };
    }
  }

  /**
   * Resolve domain to IP address
   */
  async resolveDomain(domain) {
    try {
      const addresses = await dns.resolve4(domain);
      
      if (addresses && addresses.length > 0) {
        return addresses[0];
      }
      
      return null;
    } catch (error) {
      console.error('DNS resolution failed:', error.message);
      return null;
    }
  }

  /**
   * Run system traceroute command
   */
  async runTraceroute(ip) {
    try {
      let command;
      
      if (this.isWindows) {
        command = `tracert -d -h 30 -w 1000 ${ip}`;
        console.log(`🔍 Running: ${command}`);
        
        const { stdout } = await execAsync(command, { 
          timeout: 60000,
          maxBuffer: 1024 * 1024 * 10
        });
        
        return this.parseWindowsTracert(stdout);
      } else {
        try {
          command = `mtr --report --report-cycles 3 --no-dns ${ip}`;
          const { stdout } = await execAsync(command, { timeout: 30000 });
          return this.parseMtrOutput(stdout);
        } catch (mtrError) {
          command = `traceroute -n -q 1 -m 30 ${ip}`;
          const { stdout } = await execAsync(command, { timeout: 30000 });
          return this.parseTracerouteOutput(stdout);
        }
      }

    } catch (error) {
      console.error('Traceroute execution failed:', error.message);
      return [];
    }
  }

  /**
   * Parse Windows tracert output
   */
  parseWindowsTracert(output) {
    const lines = output.split('\n');
    const hops = [];
    let hopNumber = 1;

    for (const line of lines) {
      if (line.includes('Tracing route') || 
          line.includes('over a maximum') || 
          line.includes('Trace complete') ||
          line.trim() === '') {
        continue;
      }

      const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      
      if (ipMatch) {
        const ip = ipMatch[1];
        const allTimes = [...line.matchAll(/(\d+)\s*ms/g)];
        let rtt = 0;
        
        if (allTimes.length > 0) {
          const times = allTimes.map(m => parseInt(m[1]));
          rtt = times.reduce((a, b) => a + b, 0) / times.length;
        }

        hops.push({
          hop: hopNumber++,
          ip: ip,
          rtt: rtt || 0,
          loss: 0
        });
      } else if (line.match(/^\s*\d+\s+\*/)) {
        hopNumber++;
      }
    }

    return hops;
  }

  /**
   * Parse mtr output
   */
  parseMtrOutput(output) {
    const lines = output.split('\n');
    const hops = [];

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\.\s+(\d+\.\d+\.\d+\.\d+)\s+[\d.]+%\s+\d+\s+([\d.]+)\s+([\d.]+)/);
      
      if (match) {
        const [, hopNum, ip, lastRtt, avgRtt] = match;
        hops.push({
          hop: parseInt(hopNum),
          ip: ip,
          rtt: parseFloat(avgRtt) || parseFloat(lastRtt) || 0,
          loss: 0
        });
      }
    }

    return hops;
  }

  /**
   * Parse standard traceroute output
   */
  parseTracerouteOutput(output) {
    const lines = output.split('\n');
    const hops = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('traceroute') || !line) continue;

      const match = line.match(/^\s*(\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+([\d.]+)\s*ms/);
      
      if (match) {
        const [, hopNum, ip, rtt] = match;
        hops.push({
          hop: parseInt(hopNum),
          ip: ip,
          rtt: parseFloat(rtt),
          loss: 0
        });
      }
    }

    return hops;
  }

  /**
   * Enrich hops with geolocation and ASN data
   */
  async enrichHops(hops) {
    const enriched = [];

    for (const hop of hops) {
      const geo = geoService.getGeoLocation(hop.ip);
      const asn = await asnService.getASN(hop.ip);

      enriched.push({
        ...hop,
        lat: geo.lat,
        lon: geo.lon,
        city: geo.city,
        country: geo.country,
        asn: asn.asn,
        asnOrg: asn.org,
        isCdn: asn.isCdn,
        cdnProvider: asn.cdnProvider,
        routeType: 'land', // Default to land, will be updated by cable analysis
        cableUsed: null
      });
    }

    return enriched;
  }

  /**
   * Calculate distances between hops
   * NOTE: routeType is now set by cable analysis, not by distance heuristic
   */
  calculateDistances(hops) {
    let totalDistance = 0;
    let landDistance = 0;
    let seaDistance = 0;

    for (let i = 0; i < hops.length - 1; i++) {
      const hop1 = hops[i];
      const hop2 = hops[i + 1];

      if (!hop1.lat || !hop2.lat) continue;

      const distance = this.haversineDistance(
        hop1.lat, hop1.lon,
        hop2.lat, hop2.lon
      );

      // Use the routeType that was set by cable analysis
      const isSea = hop1.routeType === 'sea';

      if (isSea) {
        seaDistance += distance;
      } else {
        landDistance += distance;
      }

      totalDistance += distance;
      hop1.distanceToNext = distance;
    }

    return {
      total: Math.round(totalDistance),
      land: Math.round(landDistance),
      sea: Math.round(seaDistance)
    };
  }

  /**
   * Haversine formula for distance calculation
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
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

  /**
   * Detect CDN usage
   */
  detectCDN(hops) {
    for (const hop of hops) {
      if (hop.isCdn) {
        return {
          detected: true,
          provider: hop.cdnProvider,
          hopNumber: hop.hop
        };
      }
    }
    return { detected: false, provider: null };
  }

  /**
   * Calculate total one-way travel time
   */
  calculateTotalTime(hops) {
    if (hops.length === 0) return 0;
    
    const lastHop = hops[hops.length - 1];
    return Math.round((lastHop.rtt / 2) * 1000) / 1000;
  }
}

module.exports = new TracerouteService();
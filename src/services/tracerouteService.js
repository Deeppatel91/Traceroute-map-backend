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

      // Calculate total time - use the last hop's RTT
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
   * Run system traceroute command - FIXED VERSION
   */
  async runTraceroute(ip) {
    try {
      let command;
      
      if (this.isWindows) {
        // FIXED: Reduced max hops and increased timeout significantly
        command = `tracert -d -h 20 -w 5000 ${ip}`;
        console.log(`🔍 Running: ${command}`);
        
        const { stdout } = await execAsync(command, { 
          timeout: 120000, // 2 minutes - increased from 90 seconds
          maxBuffer: 1024 * 1024 * 10,
          windowsHide: true // Hide command window
        });
        
        return this.parseWindowsTracert(stdout);
      } else {
        try {
          command = `mtr --report --report-cycles 3 --no-dns ${ip}`;
          const { stdout } = await execAsync(command, { timeout: 45000 });
          return this.parseMtrOutput(stdout);
        } catch (mtrError) {
          command = `traceroute -n -q 3 -m 20 -w 5 ${ip}`;
          const { stdout } = await execAsync(command, { timeout: 60000 });
          return this.parseTracerouteOutput(stdout);
        }
      }

    } catch (error) {
      console.error('Traceroute execution failed:', error.message);
      
      // Return partial results if available
      if (error.stdout) {
        console.log('⚠️  Attempting to parse partial output...');
        if (this.isWindows) {
          const partialHops = this.parseWindowsTracert(error.stdout);
          if (partialHops.length > 0) {
            console.log(`✅ Recovered ${partialHops.length} hops from partial output`);
            return partialHops;
          }
        }
      }
      
      return [];
    }
  }

  /**
   * Parse Windows tracert output - IMPROVED VERSION
   */
  parseWindowsTracert(output) {
    const lines = output.split('\n');
    const hops = [];
    let consecutiveTimeouts = 0;
    const MAX_CONSECUTIVE_TIMEOUTS = 5; // Stop after 5 consecutive timeouts

    for (const line of lines) {
      // Skip header and footer lines
      if (line.includes('Tracing route') || 
          line.includes('over a maximum') || 
          line.includes('Trace complete') ||
          line.trim() === '') {
        continue;
      }

      // Match lines that start with hop number
      const hopMatch = line.match(/^\s*(\d+)\s+/);
      if (!hopMatch) continue;

      const lineHopNum = parseInt(hopMatch[1]);
      
      // Check if this is a timeout line (contains asterisks or "Request timed out")
      if (line.includes('*') || line.includes('Request timed out')) {
        consecutiveTimeouts++;
        
        // Stop if too many consecutive timeouts (likely unreachable)
        if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          console.log(`⚠️  Stopped at hop ${lineHopNum} after ${MAX_CONSECUTIVE_TIMEOUTS} consecutive timeouts`);
          break;
        }
        
        hops.push({
          hop: lineHopNum,
          ip: null,
          rtt: null,
          loss: 100,
          timeout: true
        });
        continue;
      }

      // Reset timeout counter on successful hop
      consecutiveTimeouts = 0;

      // Try to extract IP address
      const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      
      if (ipMatch) {
        const ip = ipMatch[1];
        
        // Extract all time values from the line (looking for patterns like "10 ms", "<1 ms")
        const timeMatches = [...line.matchAll(/(?:<)?(\d+)\s*ms/gi)];
        let rtt = null;
        let loss = 0;
        
        if (timeMatches.length > 0) {
          // Calculate average RTT from available measurements
          const times = timeMatches.map(m => {
            const val = parseInt(m[1]);
            return isNaN(val) ? 1 : val; // Handle "<1 ms" as 1ms
          });
          rtt = times.reduce((a, b) => a + b, 0) / times.length;
          
          // Calculate packet loss if less than 3 measurements
          if (times.length < 3) {
            loss = ((3 - times.length) / 3) * 100;
          }
        } else {
          // No time found, use 0
          rtt = 0;
        }

        hops.push({
          hop: lineHopNum,
          ip: ip,
          rtt: rtt,
          loss: loss,
          timeout: false
        });
      }
    }

    console.log(`📊 Parsed ${hops.length} hops (${hops.filter(h => !h.timeout).length} active, ${hops.filter(h => h.timeout).length} timeouts)`);
    return hops;
  }

  /**
   * Parse mtr output
   */
  parseMtrOutput(output) {
    const lines = output.split('\n');
    const hops = [];

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\.\s+(\d+\.\d+\.\d+\.\d+)\s+([\d.]+)%\s+\d+\s+([\d.]+)\s+([\d.]+)/);
      
      if (match) {
        const [, hopNum, ip, lossPercent, lastRtt, avgRtt] = match;
        hops.push({
          hop: parseInt(hopNum),
          ip: ip,
          rtt: parseFloat(avgRtt) || parseFloat(lastRtt) || 0,
          loss: parseFloat(lossPercent) || 0,
          timeout: false
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
    let consecutiveTimeouts = 0;
    const MAX_CONSECUTIVE_TIMEOUTS = 5;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('traceroute') || !line) continue;

      const match = line.match(/^\s*(\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+([\d.]+)\s*ms/);
      
      if (match) {
        const [, hopNum, ip, rtt] = match;
        consecutiveTimeouts = 0;
        hops.push({
          hop: parseInt(hopNum),
          ip: ip,
          rtt: parseFloat(rtt),
          loss: 0,
          timeout: false
        });
      } else if (line.match(/^\s*(\d+)\s+\*/)) {
        consecutiveTimeouts++;
        
        if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          break;
        }
        
        const hopMatch = line.match(/^\s*(\d+)/);
        if (hopMatch) {
          hops.push({
            hop: parseInt(hopMatch[1]),
            ip: null,
            rtt: null,
            loss: 100,
            timeout: true
          });
        }
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
      // Handle timeout hops
      if (hop.timeout || !hop.ip) {
        enriched.push({
          ...hop,
          lat: null,
          lon: null,
          city: 'Unknown',
          country: 'Unknown',
          asn: 'Unknown',
          asnOrg: 'Unknown',
          isCdn: false,
          cdnProvider: null,
          routeType: 'land',
          cableUsed: null
        });
        continue;
      }

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
        routeType: 'land',
        cableUsed: null
      });
    }

    return enriched;
  }

  /**
   * Calculate distances between hops
   */
  calculateDistances(hops) {
    let totalDistance = 0;
    let landDistance = 0;
    let seaDistance = 0;

    for (let i = 0; i < hops.length - 1; i++) {
      const hop1 = hops[i];
      const hop2 = hops[i + 1];

      // Skip if either hop has no coordinates
      if (!hop1.lat || !hop2.lat) continue;

      const distance = this.haversineDistance(
        hop1.lat, hop1.lon,
        hop2.lat, hop2.lon
      );

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
   * Calculate total one-way travel time - FIXED VERSION
   * RTT (Round Trip Time) needs to be divided by 2 for one-way latency
   * BUT the last hop's RTT already represents the full path latency
   */
  calculateTotalTime(hops) {
    if (hops.length === 0) return 0;
    
    // Find the last valid (non-timeout) hop with RTT data
    let lastValidHop = null;
    for (let i = hops.length - 1; i >= 0; i--) {
      if (hops[i].rtt !== null && !hops[i].timeout && hops[i].rtt > 0) {
        lastValidHop = hops[i];
        break;
      }
    }
    
    if (!lastValidHop) {
      console.warn('⚠️  No valid RTT data found');
      return 0;
    }
    
    // The RTT at each hop represents round-trip time from source to that hop
    // For total latency, we use the last hop's RTT directly (not divided by 2)
    // because we want to show the full round-trip time to destination
    const totalRtt = lastValidHop.rtt;
    
    console.log(`⏱️  Total RTT: ${totalRtt.toFixed(3)}ms (from hop ${lastValidHop.hop})`);
    
    return Math.round(totalRtt * 1000) / 1000; // Round to 3 decimal places
  }
}

module.exports = new TracerouteService();
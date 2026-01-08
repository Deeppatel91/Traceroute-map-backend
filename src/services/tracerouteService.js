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
    this.isMac = os.platform() === 'darwin';
    this.isLinux = os.platform() === 'linux';
    console.log(`🖥️  Platform: ${this.isWindows ? 'Windows' : this.isMac ? 'macOS' : 'Unix/Linux'}`);
  }

  /**
   * Main traceroute function
   */
  async traceRoute(domain) {
    try {
      const targetIp = await this.resolveDomain(domain);
      
      if (!targetIp) {
        return { 
          success: false, 
          error: 'Could not resolve domain',
          domain: domain 
        };
      }

      console.log(`✅ Resolved ${domain} → ${targetIp}`);

      const hops = await this.runTraceroute(targetIp);

      if (!hops || hops.length === 0) {
        return { 
          success: false, 
          error: 'Traceroute failed - no hops returned',
          domain: domain,
          targetIp: targetIp
        };
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
        cdnHop: cdnInfo.hopNumber,
        hops: enrichedHops,
        cables: cableInfo,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Traceroute error:', error);
      return { 
        success: false, 
        error: error.message,
        domain: domain || 'unknown'
      };
    }
  }

  /**
   * Resolve domain to IP address with fallback
   */
  async resolveDomain(domain) {
    try {
      // Try IPv4 first
      const addresses = await dns.resolve4(domain);
      
      if (addresses && addresses.length > 0) {
        return addresses[0];
      }
      
      // Fallback to any address
      const anyAddress = await dns.lookup(domain);
      return anyAddress.address;
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
        // Windows tracert command
        command = `tracert -d -h 30 -w 3000 ${ip}`;
        console.log(`🔍 Running: ${command}`);
        
        const { stdout } = await execAsync(command, { 
          timeout: 120000, // 2 minutes
          maxBuffer: 1024 * 1024 * 10,
          windowsHide: true // Hide command window
        });
        
        console.log('✅ Windows tracert command completed');
        return this.parseWindowsTracert(stdout);
      } else {
        // Unix/Linux/macOS - try different commands with fallbacks
        try {
          // First try mtr if available
          console.log('🔄 Trying mtr command...');
          command = `mtr --report --report-cycles 3 --no-dns ${ip}`;
          const { stdout } = await execAsync(command, { 
            timeout: 45000,
            maxBuffer: 1024 * 1024
          });
          console.log('✅ mtr command completed');
          return this.parseMtrOutput(stdout);
        } catch (mtrError) {
          console.log('⚠️  mtr failed, trying traceroute...');
          try {
            // Use sudo for Linux if needed, or regular traceroute
            if (this.isLinux) {
              command = `sudo traceroute -n -I -q 3 -m 30 -w 2 ${ip}`;
            } else if (this.isMac) {
              // macOS specific options
              command = `traceroute -n -I -q 3 -m 30 -w 2 ${ip}`;
            } else {
              command = `traceroute -n -q 3 -m 30 -w 2 ${ip}`;
            }
            
            console.log(`🔍 Running: ${command}`);
            const { stdout, stderr } = await execAsync(command, { 
              timeout: 60000,
              maxBuffer: 1024 * 1024
            });
            
            if (stderr && stderr.includes('Operation not permitted')) {
              console.log('⚠️  ICMP permission denied, trying without -I flag...');
              command = command.replace(' -I ', ' ');
              const { stdout: stdout2 } = await execAsync(command, { 
                timeout: 60000,
                maxBuffer: 1024 * 1024
              });
              console.log('✅ traceroute command completed (without ICMP)');
              return this.parseTracerouteOutput(stdout2);
            }
            
            console.log('✅ traceroute command completed');
            return this.parseTracerouteOutput(stdout);
          } catch (tracerouteError) {
            console.error('Traceroute failed:', tracerouteError.message);
            
            // Try to parse any partial output
            if (tracerouteError.stdout) {
              console.log('⚠️  Attempting to parse partial traceroute output...');
              const partialHops = this.parseTracerouteOutput(tracerouteError.stdout);
              if (partialHops.length > 0) {
                console.log(`✅ Recovered ${partialHops.length} hops from partial output`);
                return partialHops;
              }
            }
            
            // Final fallback - try tcptraceroute
            console.log('🔄 Trying tcptraceroute as last resort...');
            try {
              command = `tcptraceroute -n -q 3 -m 30 ${ip} 80`;
              const { stdout } = await execAsync(command, { 
                timeout: 60000,
                maxBuffer: 1024 * 1024
              });
              console.log('✅ tcptraceroute command completed');
              return this.parseTcptracerouteOutput(stdout);
            } catch (finalError) {
              console.error('All traceroute methods failed');
              return [];
            }
          }
        }
      }
    } catch (error) {
      console.error('Traceroute execution failed:', error.message);
      
      // Try to extract any partial results
      if (error.stdout) {
        console.log('⚠️  Attempting to parse partial output from error...');
        let partialHops = [];
        
        if (this.isWindows) {
          partialHops = this.parseWindowsTracert(error.stdout);
        } else {
          partialHops = this.parseTracerouteOutput(error.stdout);
        }
        
        if (partialHops.length > 0) {
          console.log(`✅ Recovered ${partialHops.length} hops from partial output`);
          return partialHops;
        }
      }
      
      console.error('❌ No hops could be recovered');
      return [];
    }
  }

  /**
   * Parse tcptraceroute output
   */
  parseTcptracerouteOutput(output) {
    const lines = output.split('\n');
    const hops = [];

    for (const line of lines) {
      // tcptraceroute output format: hop ip rtt rtt rtt
      const match = line.match(/^\s*(\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(?:([\d.]+) ms\s*)?(?:([\d.]+) ms\s*)?(?:([\d.]+) ms)?/);
      
      if (match) {
        const [, hopNum, ip, rtt1, rtt2, rtt3] = match;
        
        // Calculate average RTT from available measurements
        const rtts = [];
        if (rtt1) rtts.push(parseFloat(rtt1));
        if (rtt2) rtts.push(parseFloat(rtt2));
        if (rtt3) rtts.push(parseFloat(rtt3));
        
        const avgRtt = rtts.length > 0 ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
        const loss = ((3 - rtts.length) / 3) * 100;

        hops.push({
          hop: parseInt(hopNum),
          ip: ip,
          rtt: avgRtt,
          loss: loss,
          timeout: false,
          isPrivate: this.isPrivateIP(ip)
        });
      }
    }

    return hops;
  }

  /**
   * Check if IP is private
   */
  isPrivateIP(ip) {
    if (!ip) return true;
    
    // Private IP ranges
    const privateRanges = [
      /^10\./,                      // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./,                // 192.168.0.0/16
      /^127\./,                     // 127.0.0.0/8 (localhost)
      /^169\.254\./,                // APIPA/Link-local
      /^::1$/,                      // IPv6 localhost
      /^fc00:/,                     // IPv6 private
      /^fe80:/,                     // IPv6 link-local
    ];
    
    return privateRanges.some(range => range.test(ip));
  }

  /**
   * Parse Windows tracert output - IMPROVED VERSION
   */
  parseWindowsTracert(output) {
    const lines = output.split('\n');
    const hops = [];
    const hopMap = new Map(); // To handle multiple lines per hop
    let currentHop = null;
    let consecutiveTimeouts = 0;
    const MAX_CONSECUTIVE_TIMEOUTS = 10;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip header and footer lines
      if (trimmedLine.includes('Tracing route') || 
          trimmedLine.includes('over a maximum') || 
          trimmedLine.includes('Trace complete') ||
          trimmedLine === '') {
        continue;
      }

      // Match lines that start with hop number
      const hopMatch = trimmedLine.match(/^(\d+)\s+/);
      if (!hopMatch) {
        // Check if this line continues a previous hop (contains RTT measurements)
        if (currentHop && trimmedLine.includes('ms') && !trimmedLine.includes('*')) {
          this.parseTracertRTTLine(trimmedLine, currentHop);
        }
        continue;
      }

      const hopNum = parseInt(hopMatch[1]);
      
      // If we already have this hop number in the map, update it
      if (hopMap.has(hopNum)) {
        currentHop = hopMap.get(hopNum);
      } else {
        currentHop = {
          hop: hopNum,
          ip: null,
          rtts: [], // Store all RTT measurements
          loss: 0,
          timeout: false,
          isPrivate: false,
          hopLines: 0
        };
        hopMap.set(hopNum, currentHop);
      }

      currentHop.hopLines++;

      // Check if this is a timeout line
      if (trimmedLine.includes('*') || trimmedLine.includes('Request timed out')) {
        currentHop.timeout = true;
        consecutiveTimeouts++;
        continue;
      }

      // Reset timeout counter on successful hop
      consecutiveTimeouts = 0;

      // Try to extract IP address
      const ipMatch = trimmedLine.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      
      if (ipMatch) {
        const ip = ipMatch[1];
        currentHop.ip = ip;
        currentHop.isPrivate = this.isPrivateIP(ip);
        currentHop.timeout = false;
      }

      // Parse RTT measurements from this line
      this.parseTracertRTTLine(trimmedLine, currentHop);
    }

    // Convert hop map to array and calculate averages
    for (const [hopNum, hopData] of hopMap) {
      let rtt = null;
      let loss = 0;
      
      if (hopData.timeout || !hopData.ip) {
        loss = 100;
      } else if (hopData.rtts.length > 0) {
        // Calculate average RTT
        rtt = hopData.rtts.reduce((a, b) => a + b, 0) / hopData.rtts.length;
        
        // Calculate loss based on expected 3 probes
        loss = ((3 - hopData.rtts.length) / 3) * 100;
      }

      hops.push({
        hop: hopNum,
        ip: hopData.ip,
        rtt: rtt,
        loss: Math.min(loss, 100),
        timeout: hopData.timeout || !hopData.ip,
        isPrivate: hopData.isPrivate
      });
    }

    // Sort by hop number
    hops.sort((a, b) => a.hop - b.hop);
    
    console.log(`📊 Parsed ${hops.length} hops`);
    return hops;
  }

  /**
   * Parse RTT measurements from Windows tracert line
   */
  parseTracertRTTLine(line, hopData) {
    // Match all RTT measurements in the line
    const rttMatches = [...line.matchAll(/(?:<)?(\d+)\s*ms/g)];
    
    for (const match of rttMatches) {
      const rtt = parseInt(match[1]) || 1; // Handle "<1 ms" as 1ms
      hopData.rtts.push(rtt);
    }
  }

  /**
   * Parse mtr output
   */
  parseMtrOutput(output) {
    const lines = output.split('\n');
    const hops = [];

    for (const line of lines) {
      // mtr format: hop ip loss% sent last avg best worst
      const match = line.match(/^\s*(\d+)\.\s+(\S+)\s+([\d.]+)%\s+\d+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      
      if (match) {
        const [, hopNum, ip, lossPercent, lastRtt, avgRtt] = match;
        
        // Skip if IP is not valid (could be DNS name)
        if (!ip.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)) {
          continue;
        }
        
        hops.push({
          hop: parseInt(hopNum),
          ip: ip,
          rtt: parseFloat(avgRtt) || parseFloat(lastRtt) || 0,
          loss: parseFloat(lossPercent) || 0,
          timeout: false,
          isPrivate: this.isPrivateIP(ip)
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
    const hopMap = new Map();
    let consecutiveTimeouts = 0;
    const MAX_CONSECUTIVE_TIMEOUTS = 5;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('traceroute') || !line) continue;

      // Handle multi-line entries (multiple probes per hop)
      const hopMatch = line.match(/^\s*(\d+)\s+(.*)/);
      if (!hopMatch) continue;

      const hopNum = parseInt(hopMatch[1]);
      const rest = hopMatch[2];
      
      // Check if this is a new hop or continuation
      if (!hopMap.has(hopNum)) {
        hopMap.set(hopNum, {
          hop: hopNum,
          ip: null,
          rtts: [],
          timeout: false,
          isPrivate: false
        });
      }
      
      const hopData = hopMap.get(hopNum);

      // Check for timeouts
      if (rest.includes('*')) {
        hopData.timeout = true;
        consecutiveTimeouts++;
        
        if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          console.log(`⚠️  Stopping after ${MAX_CONSECUTIVE_TIMEOUTS} consecutive timeouts`);
          break;
        }
        continue;
      }

      // Reset timeout counter
      consecutiveTimeouts = 0;
      hopData.timeout = false;

      // Extract IP address
      const ipMatch = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (ipMatch) {
        hopData.ip = ipMatch[1];
        hopData.isPrivate = this.isPrivateIP(hopData.ip);
      }

      // Extract RTT values
      const rttMatches = [...rest.matchAll(/([\d.]+)\s*ms/g)];
      rttMatches.forEach(match => {
        const rtt = parseFloat(match[1]);
        if (!isNaN(rtt)) {
          hopData.rtts.push(rtt);
        }
      });
    }

    // Convert to final array
    for (const [hopNum, hopData] of hopMap) {
      let rtt = null;
      let loss = 0;
      
      if (hopData.timeout || !hopData.ip) {
        loss = 100;
      } else if (hopData.rtts.length > 0) {
        rtt = hopData.rtts.reduce((a, b) => a + b, 0) / hopData.rtts.length;
        loss = ((3 - hopData.rtts.length) / 3) * 100;
      }

      hops.push({
        hop: hopNum,
        ip: hopData.ip,
        rtt: rtt,
        loss: Math.min(loss, 100),
        timeout: hopData.timeout,
        isPrivate: hopData.isPrivate
      });
    }

    // Sort by hop number
    hops.sort((a, b) => a.hop - b.hop);
    
    return hops;
  }

  /**
   * Enrich hops with geolocation and ASN data
   */
  async enrichHops(hops) {
    const enriched = [];

    for (const hop of hops) {
      // Handle timeout and private IPs
      if (hop.timeout || !hop.ip || hop.isPrivate) {
        enriched.push({
          ...hop,
          lat: null,
          lon: null,
          city: hop.isPrivate ? 'Private Network' : 'Unknown',
          country: hop.isPrivate ? 'Local' : 'Unknown',
          asn: hop.isPrivate ? 'Private' : 'Unknown',
          asnOrg: hop.isPrivate ? 'Private Network' : 'Unknown',
          isCdn: false,
          cdnProvider: null,
          routeType: 'land',
          cableUsed: null,
          location: hop.isPrivate ? 'Private IP Range' : 'Unresolved'
        });
        continue;
      }

      try {
        // Get geolocation data
        const geo = geoService.getGeoLocation(hop.ip);
        
        // Get ASN data
        const asn = await asnService.getASN(hop.ip);
        
        enriched.push({
          ...hop,
          lat: geo.lat,
          lon: geo.lon,
          city: geo.city || 'Unknown',
          country: geo.country || 'Unknown',
          asn: asn.asn || 'Unknown',
          asnOrg: asn.org || 'Unknown',
          isCdn: asn.isCdn || false,
          cdnProvider: asn.cdnProvider || null,
          routeType: 'land', // Will be updated by cableService
          cableUsed: null,
          location: geo.city && geo.country ? `${geo.city}, ${geo.country}` : 'Unknown'
        });
      } catch (error) {
        console.error(`Error enriching hop ${hop.hop} (${hop.ip}):`, error.message);
        enriched.push({
          ...hop,
          lat: null,
          lon: null,
          city: 'Error',
          country: 'Error',
          asn: 'Error',
          asnOrg: 'Error',
          isCdn: false,
          cdnProvider: null,
          routeType: 'land',
          cableUsed: null,
          location: 'Failed to resolve'
        });
      }
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
      if (!hop1.lat || !hop2.lat || hop1.lat === 'null' || hop2.lat === 'null') {
        continue;
      }

      // Parse coordinates if they're strings
      const lat1 = typeof hop1.lat === 'string' ? parseFloat(hop1.lat) : hop1.lat;
      const lon1 = typeof hop1.lon === 'string' ? parseFloat(hop1.lon) : hop1.lon;
      const lat2 = typeof hop2.lat === 'string' ? parseFloat(hop2.lat) : hop2.lat;
      const lon2 = typeof hop2.lon === 'string' ? parseFloat(hop2.lon) : hop2.lon;

      if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
        continue;
      }

      const distance = this.haversineDistance(lat1, lon1, lat2, lon2);

      const isSea = hop1.routeType === 'sea';

      if (isSea) {
        seaDistance += distance;
      } else {
        landDistance += distance;
      }

      totalDistance += distance;
      hop1.distanceToNext = Math.round(distance);
    }

    // Set distance to next as 0 for last hop
    if (hops.length > 0) {
      hops[hops.length - 1].distanceToNext = 0;
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
    const R = 6371; // Earth's radius in kilometers
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
      if (hop.isCdn && hop.cdnProvider) {
        return {
          detected: true,
          provider: hop.cdnProvider,
          hopNumber: hop.hop
        };
      }
      
      // Also check ASN organization for CDN keywords
      if (hop.asnOrg) {
        const asnOrgLower = hop.asnOrg.toLowerCase();
        if (asnOrgLower.includes('cloudflare')) {
          return {
            detected: true,
            provider: 'Cloudflare',
            hopNumber: hop.hop
          };
        } else if (asnOrgLower.includes('akamai')) {
          return {
            detected: true,
            provider: 'Akamai',
            hopNumber: hop.hop
          };
        } else if (asnOrgLower.includes('fastly')) {
          return {
            detected: true,
            provider: 'Fastly',
            hopNumber: hop.hop
          };
        }
      }
    }
    return { detected: false, provider: null, hopNumber: null };
  }

  /**
   * Calculate total one-way travel time
   */
  calculateTotalTime(hops) {
    if (hops.length === 0) return 0;
    
    // Find the last valid hop with RTT data
    let lastValidHop = null;
    for (let i = hops.length - 1; i >= 0; i--) {
      if (hops[i].rtt !== null && !hops[i].timeout && hops[i].rtt > 0) {
        lastValidHop = hops[i];
        break;
      }
    }
    
    if (!lastValidHop) {
      console.warn('⚠️  No valid RTT data found in any hop');
      return 0;
    }
    
    // Return the RTT as round-trip time
    const totalRtt = lastValidHop.rtt;
    
    console.log(`⏱️  Total RTT: ${totalRtt.toFixed(3)}ms (from hop ${lastValidHop.hop})`);
    
    return Math.round(totalRtt * 1000) / 1000;
  }
}

module.exports = new TracerouteService();
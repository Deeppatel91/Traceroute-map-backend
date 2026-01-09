const { exec } = require("child_process");
const { promisify } = require("util");
const dns = require("dns").promises;
const os = require("os");

const execAsync = promisify(exec);

const geoService = require("./geoService");
const asnService = require("./asnService");
const cableService = require("./cableService");

class TracerouteService {
  constructor() {
    this.isWindows = os.platform() === "win32";
    this.isMac = os.platform() === "darwin";
    this.isLinux = os.platform() === "linux";
    console.log(
      `🖥️  Platform: ${
        this.isWindows ? "Windows" : this.isMac ? "macOS" : "Unix/Linux"
      }`
    );
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
          error: "Could not resolve domain",
          domain
        };
      }

      console.log(`✅ Resolved ${domain} → ${targetIp}`);

      const hops = await this.runTraceroute(targetIp);

      if (!hops || hops.length === 0) {
        return {
          success: false,
          error: "Traceroute failed - no hops returned",
          domain,
          targetIp
        };
      }

      console.log(`✅ Parsed ${hops.length} raw hops`);

      // Enrich each hop with geo + ASN data
      const enrichedHops = await this.enrichHops(hops);

      // Trim trailing useless hops: full timeouts with no IP at the end
      const cleanedHops = this.trimTrailingEmptyHops(enrichedHops);

      console.log(`✅ Using ${cleanedHops.length} cleaned hops`);

      // Analyze submarine cables - this will also set routeType for each hop
      const cableInfo = await cableService.analyzeCableUsage(cleanedHops);

      // Calculate distances AFTER cable analysis (so we have routeType set)
      const distances = this.calculateDistances(cleanedHops);

      // Detect CDN
      const cdnInfo = this.detectCDN(cleanedHops);

      // Calculate total time - use last valid hop RTT
      const totalTime = this.calculateTotalTime(cleanedHops);

      return {
        success: true,
        domain,
        targetIp,
        totalHops: cleanedHops.length,
        totalDistance: distances.total,
        landDistance: distances.land,
        seaDistance: distances.sea,
        totalTime,
        hasCdn: cdnInfo.detected,
        cdnProvider: cdnInfo.provider,
        cdnHop: cdnInfo.hopNumber,
        hops: cleanedHops,
        cables: cableInfo,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Traceroute error:", error);
      return {
        success: false,
        error: error.message,
        domain: domain || "unknown"
      };
    }
  }

  /**
   * Resolve domain to IP address with fallback
   */
  async resolveDomain(domain) {
    try {
      // Prefer IPv4
      const addresses = await dns.resolve4(domain);
      if (addresses && addresses.length > 0) return addresses[0];

      // Fallback
      const anyAddress = await dns.lookup(domain);
      return anyAddress.address;
    } catch (error) {
      console.error("DNS resolution failed:", error.message);
      return null;
    }
  }

  /**
   * Run system traceroute command (Windows / Unix / mtr / fallbacks)
   */
  async runTraceroute(ip) {
    try {
      let command;

      if (this.isWindows) {
        // Windows tracert
        command = `tracert -d -h 30 -w 3000 ${ip}`;
        console.log(`🔍 Running: ${command}`);

        const { stdout } = await execAsync(command, {
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 10,
          windowsHide: true
        });

        console.log("✅ Windows tracert command completed");
        return this.parseWindowsTracert(stdout);
      } else {
        // Try mtr first
        try {
          console.log("🔄 Trying mtr command...");
          command = `mtr --report --report-cycles 3 --no-dns ${ip}`;
          const { stdout } = await execAsync(command, {
            timeout: 45000,
            maxBuffer: 1024 * 1024
          });
          console.log("✅ mtr command completed");
          return this.parseMtrOutput(stdout);
        } catch (mtrError) {
          console.log("⚠️  mtr failed, trying traceroute...");

          try {
            if (this.isLinux) {
              command = `traceroute -n -I -q 3 -m 30 -w 2 ${ip}`;
            } else if (this.isMac) {
              command = `traceroute -n -I -q 3 -m 30 -w 2 ${ip}`;
            } else {
              command = `traceroute -n -q 3 -m 30 -w 2 ${ip}`;
            }

            console.log(`🔍 Running: ${command}`);
            const { stdout, stderr } = await execAsync(command, {
              timeout: 60000,
              maxBuffer: 1024 * 1024
            });

            // Handle ICMP permission problems
            if (stderr && stderr.includes("Operation not permitted")) {
              console.log("⚠️  ICMP permission denied, trying without -I flag...");
              const noICMP = command.replace(" -I ", " ");
              const { stdout: stdout2 } = await execAsync(noICMP, {
                timeout: 60000,
                maxBuffer: 1024 * 1024
              });
              console.log("✅ traceroute command completed (without ICMP)");
              return this.parseTracerouteOutput(stdout2);
            }

            console.log("✅ traceroute command completed");
            return this.parseTracerouteOutput(stdout);
          } catch (tracerouteError) {
            console.error("Traceroute failed:", tracerouteError.message);

            // Try partial output if we have it
            if (tracerouteError.stdout) {
              console.log("⚠️  Attempting to parse partial traceroute output...");
              const partialHops = this.parseTracerouteOutput(tracerouteError.stdout);
              if (partialHops.length > 0) {
                console.log(
                  `✅ Recovered ${partialHops.length} hops from partial output`
                );
                return partialHops;
              }
            }

            // Final fallback: tcptraceroute
            console.log("🔄 Trying tcptraceroute as last resort...");
            try {
              command = `tcptraceroute -n -q 3 -m 30 ${ip} 80`;
              const { stdout } = await execAsync(command, {
                timeout: 60000,
                maxBuffer: 1024 * 1024
              });
              console.log("✅ tcptraceroute command completed");
              return this.parseTcptracerouteOutput(stdout);
            } catch {
              console.error("All traceroute methods failed");
              return [];
            }
          }
        }
      }
    } catch (error) {
      console.error("Traceroute execution failed:", error.message);

      // Try to parse partial results
      if (error.stdout) {
        console.log("⚠️  Attempting to parse partial output from error...");
        const partialHops = this.isWindows
          ? this.parseWindowsTracert(error.stdout)
          : this.parseTracerouteOutput(error.stdout);

        if (partialHops.length > 0) {
          console.log(
            `✅ Recovered ${partialHops.length} hops from partial output`
          );
          return partialHops;
        }
      }

      console.error("❌ No hops could be recovered");
      return [];
    }
  }

  /**
   * Parse tcptraceroute output
   */
  parseTcptracerouteOutput(output) {
    const lines = output.split("\n");
    const hops = [];

    for (const line of lines) {
      const match = line.match(
        /^\s*(\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(?:([\d.]+) ms\s*)?(?:([\d.]+) ms\s*)?(?:([\d.]+) ms)?/
      );

      if (match) {
        const [, hopNum, ip, rtt1, rtt2, rtt3] = match;

        const rtts = [];
        if (rtt1) rtts.push(parseFloat(rtt1));
        if (rtt2) rtts.push(parseFloat(rtt2));
        if (rtt3) rtts.push(parseFloat(rtt3));

        const avgRtt =
          rtts.length > 0
            ? rtts.reduce((a, b) => a + b, 0) / rtts.length
            : null;
        const loss = ((3 - rtts.length) / 3) * 100;

        hops.push({
          hop: parseInt(hopNum, 10),
          ip,
          rtt: avgRtt,
          loss,
          timeout: !avgRtt,
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
    if (!ip) return false;

    const privateRanges = [
      /^10\./, // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./, // 192.168.0.0/16
      /^127\./, // loopback
      /^169\.254\./ // link‑local
      // If you want IPv6, you can extend here
    ];

    return privateRanges.some(rx => rx.test(ip));
  }

  /**
   * Parse Windows tracert output
   */
  parseWindowsTracert(output) {
    const lines = output.split("\n");
    const hopMap = new Map();
    let currentHop = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (
        line.includes("Tracing route") ||
        line.includes("over a maximum") ||
        line.includes("Trace complete") ||
        line === ""
      ) {
        continue;
      }

      const hopMatch = line.match(/^(\d+)\s+/);
      if (!hopMatch) {
        // Continuation line with RTTs maybe
        if (currentHop && line.includes("ms") && !line.includes("*")) {
          this.parseTracertRTTLine(line, currentHop);
        }
        continue;
      }

      const hopNum = parseInt(hopMatch[1], 10);

      if (!hopMap.has(hopNum)) {
        hopMap.set(hopNum, {
          hop: hopNum,
          ip: null,
          rtts: [],
          timeout: false,
          isPrivate: false
        });
      }

      currentHop = hopMap.get(hopNum);

      // Timeout line
      if (line.includes("*") || line.toLowerCase().includes("request timed out")) {
        currentHop.timeout = true;
        continue;
      }

      // Extract IP
      const ipMatch = line.match(
        /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
      );
      if (ipMatch) {
        const ip = ipMatch[1];
        currentHop.ip = ip;
        currentHop.isPrivate = this.isPrivateIP(ip);
        currentHop.timeout = false;
      }

      // Extract RTTs
      this.parseTracertRTTLine(line, currentHop);
    }

    const hops = [];

    for (const [, hopData] of hopMap) {
      let rtt = null;
      let loss = 0;

      if (hopData.timeout || !hopData.ip) {
        rtt = null;
        loss = 100;
      } else if (hopData.rtts.length > 0) {
        rtt =
          hopData.rtts.reduce((a, b) => a + b, 0) / hopData.rtts.length;
        loss = ((3 - hopData.rtts.length) / 3) * 100;
      }

      hops.push({
        hop: hopData.hop,
        ip: hopData.ip,
        rtt,
        loss: Math.min(loss, 100),
        timeout: hopData.timeout || !hopData.ip,
        isPrivate: hopData.isPrivate
      });
    }

    hops.sort((a, b) => a.hop - b.hop);
    return hops;
  }

  /**
   * Parse RTT measurements from Windows tracert line
   */
  parseTracertRTTLine(line, hopData) {
    const matches = [...line.matchAll(/(?:<)?(\d+)\s*ms/gi)];
    for (const m of matches) {
      const v = parseInt(m[1], 10);
      hopData.rtts.push(Number.isNaN(v) ? 1 : v);
    }
  }

  /**
   * Parse mtr output
   * mtr --report --no-dns: "hop. ip loss% sent last avg best worst"
   */
  parseMtrOutput(output) {
    const lines = output.split("\n");
    const hops = [];

    for (const line of lines) {
      const match = line.match(
        /^\s*(\d+)\.\s+(\S+)\s+([\d.]+)%\s+\d+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/
      );
      if (!match) continue;

      const [, hopNum, host, lossPercent, lastRtt, avgRtt] = match;

      // mtr host may be IP or hostname; we only take valid IPv4 here
      const ipMatch = host.match(
        /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/
      );
      if (!ipMatch) continue;

      const ip = ipMatch[1];

      hops.push({
        hop: parseInt(hopNum, 10),
        ip,
        rtt: parseFloat(avgRtt) || parseFloat(lastRtt) || null,
        loss: parseFloat(lossPercent) || 0,
        timeout: false,
        isPrivate: this.isPrivateIP(ip)
      });
    }

    return hops;
  }

  /**
   * Parse standard traceroute output (Unix)
   */
  parseTracerouteOutput(output) {
    const lines = output.split("\n");
    const hopMap = new Map();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("traceroute")) continue;

      const hopMatch = line.match(/^\s*(\d+)\s+(.*)/);
      if (!hopMatch) continue;

      const hopNum = parseInt(hopMatch[1], 10);
      const rest = hopMatch[2];

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

      // Timeouts
      if (rest.includes("*")) {
        hopData.timeout = true;
        continue;
      }

      hopData.timeout = false;

      // IP
      const ipMatch = rest.match(
        /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
      );
      if (ipMatch) {
        hopData.ip = ipMatch[1];
        hopData.isPrivate = this.isPrivateIP(hopData.ip);
      }

      // RTTs
      const rttMatches = [...rest.matchAll(/([\d.]+)\s*ms/g)];
      for (const m of rttMatches) {
        const v = parseFloat(m[1]);
        if (!Number.isNaN(v)) hopData.rtts.push(v);
      }
    }

    const hops = [];

    for (const [, hopData] of hopMap) {
      let rtt = null;
      let loss = 0;

      if (hopData.timeout || !hopData.ip) {
        rtt = null;
        loss = 100;
      } else if (hopData.rtts.length > 0) {
        rtt =
          hopData.rtts.reduce((a, b) => a + b, 0) / hopData.rtts.length;
        loss = ((3 - hopData.rtts.length) / 3) * 100;
      }

      hops.push({
        hop: hopData.hop,
        ip: hopData.ip,
        rtt,
        loss: Math.min(loss, 100),
        timeout: hopData.timeout || !hopData.ip,
        isPrivate: hopData.isPrivate
      });
    }

    hops.sort((a, b) => a.hop - b.hop);
    return hops;
  }

  /**
   * Enrich hops with geolocation and ASN data
   */
  async enrichHops(hops) {
    const enriched = [];

    for (const hop of hops) {
      // Timeouts / no IP / private IPs
      if (!hop.ip || hop.timeout || hop.isPrivate) {
        enriched.push({
          ...hop,
          lat: null,
          lon: null,
          city: hop.isPrivate ? "Private Network" : "Unknown",
          country: hop.isPrivate ? "Local" : "Unknown",
          asn: hop.isPrivate ? "Private" : "Unknown",
          asnOrg: hop.isPrivate ? "Private Network" : "Unknown",
          isCdn: false,
          cdnProvider: null,
          routeType: "land",
          cableUsed: null,
          location: hop.isPrivate ? "Private IP Range" : "Unresolved"
        });
        continue;
      }

      try {
        // Important: await both (your geoService is async now)
        const [geo, asn] = await Promise.all([
          geoService.getGeoLocation(hop.ip),
          asnService.getASN(hop.ip)
        ]);

        enriched.push({
          ...hop,
          lat: geo.lat,
          lon: geo.lon,
          city: geo.city || "Unknown",
          country: geo.country || "Unknown",
          asn: asn.asn || "Unknown",
          asnOrg: asn.org || "Unknown",
          isCdn: asn.isCdn || false,
          cdnProvider: asn.cdnProvider || null,
          routeType: "land", // may be updated by cableService
          cableUsed: null,
          location:
            geo.city && geo.country
              ? `${geo.city}, ${geo.country}`
              : "Unknown"
        });
      } catch (err) {
        console.error(
          `Error enriching hop ${hop.hop} (${hop.ip}):`,
          err.message
        );
        enriched.push({
          ...hop,
          lat: null,
          lon: null,
          city: "Error",
          country: "Error",
          asn: "Error",
          asnOrg: "Error",
          isCdn: false,
          cdnProvider: null,
          routeType: "land",
          cableUsed: null,
          location: "Failed to resolve"
        });
      }
    }

    return enriched;
  }

  /**
   * Trim trailing hops that are just "???": full timeouts with no IP
   * (This is closer to what many online traceroute visualizers do)
   */
  trimTrailingEmptyHops(hops) {
    let lastIndex = hops.length - 1;

    while (
      lastIndex >= 0 &&
      hops[lastIndex].timeout &&
      (!hops[lastIndex].ip || hops[lastIndex].ip === "0.0.0.0")
    ) {
      lastIndex--;
    }

    return hops.slice(0, lastIndex + 1);
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

      if (hop1.lat == null || hop2.lat == null) continue;

      const lat1 =
        typeof hop1.lat === "string" ? parseFloat(hop1.lat) : hop1.lat;
      const lon1 =
        typeof hop1.lon === "string" ? parseFloat(hop1.lon) : hop1.lon;
      const lat2 =
        typeof hop2.lat === "string" ? parseFloat(hop2.lat) : hop2.lat;
      const lon2 =
        typeof hop2.lon === "string" ? parseFloat(hop2.lon) : hop2.lon;

      if (
        Number.isNaN(lat1) ||
        Number.isNaN(lon1) ||
        Number.isNaN(lat2) ||
        Number.isNaN(lon2)
      ) {
        continue;
      }

      const distance = this.haversineDistance(lat1, lon1, lat2, lon2);

      if (hop1.routeType === "sea") {
        seaDistance += distance;
      } else {
        landDistance += distance;
      }

      totalDistance += distance;
      hop1.distanceToNext = Math.round(distance);
    }

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
   * Haversine formula
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRadians(deg) {
    return deg * (Math.PI / 180);
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

      if (hop.asnOrg) {
        const org = hop.asnOrg.toLowerCase();
        if (org.includes("cloudflare")) {
          return { detected: true, provider: "Cloudflare", hopNumber: hop.hop };
        }
        if (org.includes("akamai")) {
          return { detected: true, provider: "Akamai", hopNumber: hop.hop };
        }
        if (org.includes("fastly")) {
          return { detected: true, provider: "Fastly", hopNumber: hop.hop };
        }
      }
    }

    return { detected: false, provider: null, hopNumber: null };
  }

  /**
   * Use last valid hop with RTT as total round-trip time
   */
  calculateTotalTime(hops) {
    for (let i = hops.length - 1; i >= 0; i--) {
      const h = hops[i];
      if (h && !h.timeout && h.rtt != null && h.rtt > 0) {
        const totalRtt = h.rtt;
        console.log(
          `⏱️  Total RTT: ${totalRtt.toFixed(3)}ms (from hop ${h.hop})`
        );
        return Math.round(totalRtt * 1000) / 1000;
      }
    }

    console.warn("⚠️  No valid RTT data found in any hop");
    return 0;
  }
}

module.exports = new TracerouteService();

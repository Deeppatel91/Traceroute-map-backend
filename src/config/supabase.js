const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  Supabase credentials not found. Database features will be disabled.');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Database helper functions
const db = {
  async saveTraceRequest(data) {
    if (!supabase) return null;
    
    try {
      const { data: result, error } = await supabase
        .from('trace_requests')
        .insert([{
          domain: data.domain,
          source_ip: data.sourceIp,
          total_hops: data.totalHops,
          total_distance_km: data.totalDistance,
          total_time_ms: data.totalTime,
          has_cdn: data.hasCdn,
          cdn_provider: data.cdnProvider,
          created_at: new Date().toISOString()
        }])
        .select();
      
      if (error) throw error;
      return result;
    } catch (error) {
      console.error('Database save error:', error.message);
      return null;
    }
  },

  async getPopularDomains(limit = 10) {
    if (!supabase) return [];
    
    try {
      const { data, error } = await supabase
        .from('trace_requests')
        .select('domain, count')
        .order('count', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Database query error:', error.message);
      return [];
    }
  }
};

module.exports = { supabase, db };
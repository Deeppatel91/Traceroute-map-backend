const express = require('express');
const cors = require('cors');
const path = require('path');

// Load environment variables from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const tracerouteRoutes = require('./routes/traceroute');

const app = express();
const PORT = process.env.PORT || 5000;

// Log environment loading status
console.log('🔧 Environment Configuration:');
console.log(`   PORT: ${process.env.PORT || '5000 (default)'}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅ Loaded' : '❌ Missing'}`);
console.log(`   SUPABASE_KEY: ${process.env.SUPABASE_KEY ? '✅ Loaded' : '❌ Missing'}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Packet Visualizer Backend Running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    supabase: process.env.SUPABASE_URL ? 'connected' : 'disabled'
  });
});

// Routes
app.use('/api/trace', tracerouteRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.url 
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n🚀 Packet Visualizer Backend`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${process.env.SUPABASE_URL ? 'Supabase Connected ✅' : 'Database Disabled ⚠️'}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}\n`);
});

module.exports = app;
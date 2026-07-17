const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const visitRoutes = require('./routes/visits');
const hostRoutes = require('./routes/hosts');
const visitorTypeRoutes = require('./routes/visitorTypes');
const preRegRoutes = require('./routes/preRegistered');
const deliveryRoutes = require('./routes/deliveries');
const evacuationRoutes = require('./routes/evacuations');
const dashboardRoutes = require('./routes/dashboard');
const eventRoutes = require('./routes/events');
const documentRoutes = require('./routes/documents');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow multiple origins (Vercel preview + production + custom domain)
const allowedOrigins = [
  'http://localhost:3000',
  'https://sentinels-signin.vercel.app',
  'https://sentinels-signin-90myhqvsl-sentinels-it.vercel.app',
  'https://sentinels-signin-fjsex8f73-sentinels-it.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.log('CORS blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Sentinels Sign-In API', version: '1.0.0' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/hosts', hostRoutes);
app.use('/api/visitor-types', visitorTypeRoutes);
app.use('/api/pre-registered', preRegRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/evacuations', evacuationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/documents', documentRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`\uD83D\uDE80 Sentinels Sign-In API running on port ${PORT}`);
});

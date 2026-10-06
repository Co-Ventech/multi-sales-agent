const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const connectDB = require('./db');
const schedulerService = require('./src/services/schedulerService');


const authRoutes = require('./src/api/routes/auth');
const brandsRoutes = require('./src/api/routes/brands');
const smtpRoutes = require('./src/api/routes/smtp');
const contactsRoutes = require('./src/api/routes/contacts');
const pipelineRoutes = require('./src/api/routes/pipeline');
const previewRoutes = require('./src/api/routes/preview');
const statsRoutes = require('./src/api/routes/stats');
const apifyRoutes = require('./src/api/routes/apify');
const blogPipelineRoutes = require('./src/api/routes/blogPipeline');
const twitterJobsRoutes = require('./src/api/routes/twitterJobs');
const candidateProfilesRoutes = require('./src/api/routes/candidateProfiles');
const { ensureResumesDir, syncResumeFolder } = require('./src/services/resumeIngestionService');

const app = express();

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/brands', brandsRoutes);
app.use('/api/brands/:brandId/smtp', smtpRoutes);
app.use('/api/brands/:brandId/contacts', contactsRoutes);
app.use('/api/brands/:brandId/pipeline', pipelineRoutes);
app.use('/api/brands/:brandId/preview', previewRoutes);
app.use('/api/brands/:brandId/stats', statsRoutes);
app.use('/api/brands/:brandId/apify', apifyRoutes);
app.use('/api/blog-pipeline', blogPipelineRoutes);
app.use('/api/brands/:brandId/twitter-jobs', twitterJobsRoutes);
app.use('/api/candidate-profiles', candidateProfilesRoutes);

// Serve frontend static files in production
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

connectDB().then(async () => {
  // Initialize cron schedulers after DB is ready
  try {
    await schedulerService.initAll();
    console.log('[Scheduler] Initialized');
  } catch (err) {
    console.error('[Scheduler] Init error:', err.message);
  }

  // Resume folder sync — fire-and-forget so startup is never blocked. Only
  // parses PDFs that have not been ingested before (deduped by file hash).
  try {
    ensureResumesDir();
    syncResumeFolder(null).catch((err) => {
      console.error('[CV INGESTION] Startup sync error:', err.message);
    });
  } catch (err) {
    console.error('[CV INGESTION] Startup sync error:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
  });
});

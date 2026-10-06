const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('[DB] Connected to MongoDB Atlas');
  } catch (err) {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] Disconnected from MongoDB');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[DB] Reconnected to MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[DB] MongoDB error:', err.message);
  });
}

module.exports = connectDB;

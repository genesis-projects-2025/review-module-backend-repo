const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let pool;

try {
  let sslOptions;
  if (process.env.DB_SSL === 'true') {
    const certPath = path.resolve(__dirname, 'certs', 'aiven-ca.pem');
    if (fs.existsSync(certPath)) {
      sslOptions = {
        ca: fs.readFileSync(certPath),
        rejectUnauthorized: true,
      };
      console.log('🔐 Using Aiven CA certificate for SSL');
    } else {
      sslOptions = { rejectUnauthorized: true };
      console.log('🔐 Using default SSL (no CA file found)');
    }
  }

  if (process.env.DATABASE_URL) {
    const dbUrl = new URL(process.env.DATABASE_URL);
    pool = mysql.createPool({
      host: dbUrl.hostname,
      port: dbUrl.port ? Number(dbUrl.port) : 3306,
      user: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
      database: dbUrl.pathname.replace('/', ''),
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 50),
      ssl: sslOptions,
    });
  } else {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'pulse_new',
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 50),
      ssl: sslOptions,
    });
  }
} catch (err) {
  console.error('❌ Error creating DB pool:', err);
  process.exit(1);
}

// Test connection
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL connected successfully!');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Failed to connect to MySQL:', err.message);
    process.exit(1);
  });

module.exports = pool;

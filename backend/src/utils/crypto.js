const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
  }
  return Buffer.from(key, 'utf8');
}

function getIV() {
  const iv = process.env.ENCRYPTION_IV;
  if (!iv || iv.length !== 16) {
    throw new Error('ENCRYPTION_IV must be exactly 16 characters');
  }
  return Buffer.from(iv, 'utf8');
}

/**
 * Encrypt plaintext using AES-256-CBC
 * @param {string} text - plaintext to encrypt
 * @returns {string} - hex encoded ciphertext
 */
function encrypt(text) {
  if (!text) return '';
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), getIV());
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

/**
 * Decrypt hex-encoded ciphertext using AES-256-CBC
 * @param {string} hex - hex encoded ciphertext
 * @returns {string} - plaintext
 */
function decrypt(hex) {
  if (!hex) return '';
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), getIV());
  let decrypted = decipher.update(String(hex), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };

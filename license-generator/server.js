const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 6262;

// Middleware to parse JSON requests
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions
function toHex(buf) {
  return Buffer.from(buf).toString('hex');
}

function toB64(buf) {
  return Buffer.from(buf).toString('base64');
}

// Endpoint to generate the license key
app.post('/generate-license', async (req, res) => {
  try {
    const { signature, startDate, endDate, users, macAddress, appId, secretKey } = req.body;

    // Validate inputs
    if (!signature || !startDate || !endDate || !users || !macAddress || !appId || secretKey.length !== 32) {
      return res.status(400).json({ success: false, message: 'All fields are required, and secret key must be 32 characters.' });
    }
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({ success: false, message: 'End date must be later than start date.' });
    }

    const payload = { signature, startDate, endDate, users, macAddress, appId };
    const payloadStr = JSON.stringify(payload);
    console.log('Payload:', payloadStr);

    // AAD = SHA-512 hash of payload
    const payloadHash = crypto.createHash('sha512').update(payloadStr).digest();
    const aad = toHex(payloadHash);
    console.log('AAD:', aad);

    // Derive AES-GCM key using PBKDF2
    const keyMaterial = crypto.pbkdf2Sync(secretKey, appId, 100000, 32, 'sha256');
    console.log('Key material:', keyMaterial.toString('hex'));

    const nonce = crypto.randomBytes(12);
    console.log('Nonce (hex):', nonce.toString('hex'));
    console.log('Nonce (base64):', toB64(nonce));

    const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial, nonce);
    cipher.setAAD(Buffer.from(aad, 'hex'));

    let ciphertext = cipher.update(payloadStr, 'utf8');
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);
    const authTag = cipher.getAuthTag();
    console.log('Auth tag:', authTag.toString('hex'));

    const ciphertextWithTag = Buffer.concat([ciphertext, authTag]);
    console.log('Ciphertext with tag (hex):', ciphertextWithTag.toString('hex'));
    console.log('Ciphertext with tag (base64):', toB64(ciphertextWithTag));

    const license = {
      appId,
      nonce: toB64(nonce),
      aad,
      ciphertext: toB64(ciphertextWithTag),
    };
    const licenseStr = JSON.stringify(license);
    const licenseKey = toB64(licenseStr);
    console.log('Generated license key:', licenseKey);

    res.status(200).json({ success: true, licenseKey });
  } catch (error) {
    console.error('Error generating license key:', error.message);
    res.status(500).json({ success: false, message: 'Server error generating license key: ' + error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`License generator server running on http://localhost:6262`);
});
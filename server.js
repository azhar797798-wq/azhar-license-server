// ══════════════════════════════════════════════════════════════
// Azhar Software — License Server
// Step 3 of Desktop Roadmap
// ══════════════════════════════════════════════════════════════

const express    = require('express');
const cors       = require('cors');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
require('dotenv').config();

const app  = express();
app.use(cors());
app.use(express.json());

// ── Connect to MongoDB ────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Database connected'))
  .catch(err => console.log('❌ Database error:', err));

// ── License Model ─────────────────────────────────────────────
const licenseSchema = new mongoose.Schema({
  licenseKey:       { type: String, required: true, unique: true },
  customerName:     { type: String, required: true },
  customerPhone:    { type: String, default: '' },
  machineId:        { type: String, default: null },
  status:           { type: String, enum: ['active','blocked','expired'], default: 'active' },
  activatedAt:      { type: Date,   default: null },
  lastSeen:         { type: Date,   default: null },
  version:          { type: String, default: '14.0.0' },
  createdAt:        { type: Date,   default: Date.now },
  expiryDate:       { type: Date,   default: null },
  notes:            { type: String, default: '' },
});
const License = mongoose.model('License', licenseSchema);

// ── Update Model ──────────────────────────────────────────────
const updateSchema = new mongoose.Schema({
  version:       { type: String, required: true },
  releaseDate:   { type: Date,   default: Date.now },
  downloadUrl:   { type: String, required: true },
  releaseNotes:  { type: String, default: '' },
  isMandatory:   { type: Boolean, default: false },
  isLatest:      { type: Boolean, default: true },
});
const Update = mongoose.model('Update', updateSchema);

// ── Helper: verify admin password ────────────────────────────
function isAdmin(req) {
  const token = req.headers['admin-token'];
  return token === process.env.ADMIN_PASSWORD;
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API — called by customer software
// ══════════════════════════════════════════════════════════════

// 1. Activate license (first time setup on a device)
app.post('/api/activate', async (req, res) => {
  try {
    const { licenseKey, machineId } = req.body;
    if (!licenseKey || !machineId)
      return res.json({ success: false, message: 'License key and machine ID required' });

    const license = await License.findOne({ licenseKey });

    if (!license)
      return res.json({ success: false, message: 'Invalid license key. Contact Azhar Software.' });

    if (license.status === 'blocked')
      return res.json({ success: false, message: 'This license has been blocked. Contact Azhar Software.' });

    if (license.status === 'expired')
      return res.json({ success: false, message: 'This license has expired. Contact Azhar Software.' });

    // Already activated on a different machine
    if (license.machineId && license.machineId !== machineId)
      return res.json({ success: false, message: 'This license is already activated on another device. Contact Azhar Software to transfer.' });

    // Activate — bind to this machine
    license.machineId   = machineId;
    license.activatedAt = license.activatedAt || new Date();
    license.lastSeen    = new Date();
    await license.save();

    return res.json({
      success:      true,
      message:      'License activated successfully',
      customerName: license.customerName,
      version:      license.version,
    });

  } catch(err) {
    console.error('Activate error:', err);
    res.json({ success: false, message: 'Server error. Try again.' });
  }
});

// 2. Verify license (called every time software starts)
app.post('/api/verify', async (req, res) => {
  try {
    const { licenseKey, machineId } = req.body;
    if (!licenseKey || !machineId)
      return res.json({ valid: false, message: 'Missing data' });

    const license = await License.findOne({ licenseKey });

    if (!license)      return res.json({ valid: false, message: 'Invalid license' });
    if (license.status === 'blocked')
                       return res.json({ valid: false, message: 'License blocked. Contact Azhar Software.' });
    if (license.status === 'expired')
                       return res.json({ valid: false, message: 'License expired. Contact Azhar Software.' });
    if (license.machineId !== machineId)
                       return res.json({ valid: false, message: 'License used on different device.' });

    // Update last seen
    license.lastSeen = new Date();
    await license.save();

    return res.json({
      valid:        true,
      customerName: license.customerName,
      status:       license.status,
    });

  } catch(err) {
    res.json({ valid: false, message: 'Server error' });
  }
});

// 3. Check for updates
app.get('/api/updates/latest', async (req, res) => {
  try {
    const update = await Update.findOne({ isLatest: true });
    if (!update) return res.json({ hasUpdate: false });
    res.json({
      hasUpdate:    true,
      version:      update.version,
      downloadUrl:  update.downloadUrl,
      releaseNotes: update.releaseNotes,
      isMandatory:  update.isMandatory,
    });
  } catch(err) {
    res.json({ hasUpdate: false });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN API — only you can use these
// ══════════════════════════════════════════════════════════════

// 4. View all licenses
app.get('/admin/licenses', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const licenses = await License.find().sort({ createdAt: -1 });
  res.json(licenses);
});

// 5. Create new license key
app.post('/admin/licenses', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { customerName, customerPhone, notes } = req.body;
    // Generate license key: AZH-XXXX-XXXX-XXXX
    const part = () => Math.random().toString(36).substring(2,6).toUpperCase();
    const licenseKey = `AZH-${part()}-${part()}-${part()}`;
    const license = new License({ licenseKey, customerName, customerPhone, notes });
    await license.save();
    res.json({ success: true, licenseKey, customerName });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

// 6. Block a license
app.post('/admin/licenses/block', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { licenseKey } = req.body;
  await License.updateOne({ licenseKey }, { status: 'blocked' });
  res.json({ success: true, message: `License ${licenseKey} blocked` });
});

// 7. Unblock a license
app.post('/admin/licenses/unblock', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { licenseKey } = req.body;
  await License.updateOne({ licenseKey }, { status: 'active' });
  res.json({ success: true, message: `License ${licenseKey} unblocked` });
});

// 8. Transfer license to new device
app.post('/admin/licenses/transfer', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { licenseKey } = req.body;
  await License.updateOne({ licenseKey }, { machineId: null, activatedAt: null });
  res.json({ success: true, message: `License ${licenseKey} reset — can activate on new device` });
});

// 9. Delete a license
app.delete('/admin/licenses/:key', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  await License.deleteOne({ licenseKey: req.params.key });
  res.json({ success: true });
});

// 10. Add new update version
app.post('/admin/updates', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { version, downloadUrl, releaseNotes, isMandatory } = req.body;
    // Mark all previous as not latest
    await Update.updateMany({}, { isLatest: false });
    const update = new Update({ version, downloadUrl, releaseNotes, isMandatory, isLatest: true });
    await update.save();
    res.json({ success: true, message: `Update v${version} published` });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

// 11. Health check
app.get('/', (req, res) => {
  res.json({
    status:  'running',
    name:    'Azhar Software License Server',
    version: '1.0.0',
    time:    new Date().toISOString(),
  });
});

// ── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Azhar Software Server running on port ${PORT}`);
});

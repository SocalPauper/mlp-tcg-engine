import { Router, Request, Response } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import path from 'path';
import { pool } from '../../4_data/db.js';

const router = Router();

// Store upload in memory buffer (max 10 MB) for direct R2 streaming
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  },
});

function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

// 1. Public: Fetch all global site settings (wallpapers, opacities, announcements)
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT setting_key, setting_value, updated_at FROM auth.site_settings`
    );
    const settingsMap: Record<string, string> = {};
    for (const row of rows) {
      settingsMap[row.setting_key] = row.setting_value;
    }
    res.json({ success: true, settings: settingsMap });
  } catch (err: any) {
    console.error('[MEDIA SETTINGS GET ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to load site settings' });
  }
});

// 2. Admin: Update a scalar setting (e.g., bg_hub_opacity, site_announcement)
router.post('/settings', async (req: Request, res: Response) => {
  try {
    const { key, value, updatedBy } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, message: 'Missing key or value' });
    }

    await pool.query(
      `INSERT INTO auth.site_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()`,
      [String(key), String(value), updatedBy || 'admin']
    );

    res.json({ success: true, key, value: String(value) });
  } catch (err: any) {
    console.error('[MEDIA SETTINGS POST ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to save setting' });
  }
});

// 3. Admin: Delete / reset a setting
router.delete('/settings/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    await pool.query(`DELETE FROM auth.site_settings WHERE setting_key = $1`, [key]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[MEDIA SETTINGS DELETE ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to reset setting' });
  }
});

// 4. Upload image to Cloudflare R2 + record in auth.uploaded_media (reusable for Admin & Fan Page)
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const category = String(req.body.category || 'theme_bg'); // 'theme_bg' | 'fan_art'
    const targetKey = String(req.body.targetKey || 'hub');
    const uploadedBy = String(req.body.uploadedBy || 'admin');
    const title = String(req.body.title || req.file.originalname);

    const ext = path.extname(req.file.originalname) || '.png';
    const uniqueName = `${category}/${targetKey}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;

    let publicUrl = '';
    const r2 = getR2Client();
    const bucketName = process.env.R2_BUCKET_NAME;
    const r2PublicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

    if (r2 && bucketName && r2PublicBase) {
      await r2.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: uniqueName,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
      );
      publicUrl = `${r2PublicBase}/${uniqueName}`;
    } else {
      // Fallback to Data URL if R2 env vars aren't configured yet
      const base64 = req.file.buffer.toString('base64');
      publicUrl = `data:${req.file.mimetype};base64,${base64}`;
    }

    // Record in auth.uploaded_media
    const insertRes = await pool.query(
      `INSERT INTO auth.uploaded_media (category, target_key, title, file_name, public_url, uploaded_by, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, public_url, created_at`,
      [
        category,
        targetKey,
        title,
        uniqueName,
        publicUrl,
        uploadedBy,
        category === 'theme_bg', // Auto-approve admin theme backgrounds
      ]
    );

    // If this is a tab wallpaper, persist it globally in auth.site_settings
    if (category === 'theme_bg') {
      const settingKey = `bg_${targetKey}`;
      await pool.query(
        `INSERT INTO auth.site_settings (setting_key, setting_value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW()`,
        [settingKey, publicUrl, uploadedBy]
      );
    }

    res.json({
      success: true,
      media: insertRes.rows[0],
      publicUrl,
    });
  } catch (err: any) {
    console.error('[MEDIA UPLOAD ERROR]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Image upload failed' });
  }
});

// 5. Public Gallery Feed (Reusable for Fan Page & Admin Media Manager)
router.get('/gallery/:category', async (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    const includeUnapproved = req.query.all === 'true';

    const query = includeUnapproved
      ? `SELECT * FROM auth.uploaded_media WHERE category = $1 ORDER BY created_at DESC LIMIT 100`
      : `SELECT * FROM auth.uploaded_media WHERE category = $1 AND is_approved = TRUE ORDER BY created_at DESC LIMIT 100`;

    const { rows } = await pool.query(query, [category]);
    res.json({ success: true, items: rows });
  } catch (err: any) {
    console.error('[MEDIA GALLERY ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch gallery' });
  }
});

// 6. Admin: Delete media entry (and remove from R2 if applicable)
router.delete('/item/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `DELETE FROM auth.uploaded_media WHERE id = $1 RETURNING file_name`,
      [id]
    );

    if (rows[0]?.file_name) {
      const r2 = getR2Client();
      const bucketName = process.env.R2_BUCKET_NAME;
      if (r2 && bucketName) {
        await r2
          .send(new DeleteObjectCommand({ Bucket: bucketName, Key: rows[0].file_name }))
          .catch(() => {});
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[MEDIA DELETE ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete media' });
  }
});

export default router;
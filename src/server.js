'use strict';

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { exec }   = require('child_process');
const { promisify } = require('util');
const fs         = require('fs/promises');
const path       = require('path');
const os         = require('os');
const crypto     = require('crypto');

const execAsync = promisify(exec);
const app = express();

// ─── Sécurité ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'https://getharmonia.app'],
  methods: ['POST', 'GET'],
}));
app.use(express.json({ limit: '64kb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT ?? '60'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessaye dans une minute.' },
});
app.use('/render', limiter);

// ─── Validation LilyPond ─────────────────────────────────────────────────────

// Bloque les directives dangereuses
// Note: #(system ...) s'écrit sans espace entre # et (
const FORBIDDEN = [
  /#\s*\(?\s*(shell|system|call|define-public|load|include)\b/i,
  /ly:system/i,
  /output-suffix/i,
  /\bos\s*:/i,
];

function validateLy(code) {
  if (typeof code !== 'string') return 'Code manquant.';
  if (code.length > 32_000)    return 'Code trop long (max 32 000 caractères).';
  for (const pattern of FORBIDDEN) {
    if (pattern.test(code)) return `Directive interdite : ${pattern}`;
  }
  return null;
}

// ─── Cache simple en mémoire ─────────────────────────────────────────────────

const cache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL = 10 * 60 * 1000; // 10 min

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
}

// ─── Compilation LilyPond ────────────────────────────────────────────────────

const LILYPOND_BIN = process.env.LILYPOND_BIN ?? 'lilypond';
const TIMEOUT_MS   = parseInt(process.env.COMPILE_TIMEOUT ?? '15000');

async function compileLy(lyCode, format = 'svg') {
  const hash    = crypto.createHash('sha256').update(lyCode + format).digest('hex').slice(0, 16);
  const cached  = cacheGet(hash);
  if (cached) return { ...cached, fromCache: true };

  const tmpDir  = await fs.mkdtemp(path.join(os.tmpdir(), 'harmonia-'));
  const inFile  = path.join(tmpDir, 'score.ly');
  const outBase = path.join(tmpDir, 'score');

  try {
    await fs.writeFile(inFile, lyCode, 'utf8');

    const args = format === 'svg'
      ? `-dbackend=svg`
      : `--png -dresolution=200`;

    // LilyPond écrit toujours dans le CWD sous le nom du fichier d'entrée
    // → on compile depuis tmpDir avec input "score.ly", output sera "score.svg" ou "score.png"
    await execAsync(
      `${LILYPOND_BIN} ${args} "score.ly"`,
      { timeout: TIMEOUT_MS, cwd: tmpDir }
    );

    // Le fichier généré est toujours dans le CWD = tmpDir, nommé d'après l'input
    const outFile = path.join(tmpDir, format === 'svg' ? 'score.svg' : 'score.png');

    const data       = await fs.readFile(outFile);
    const mimeType   = format === 'svg' ? 'image/svg+xml' : 'image/png';
    const result     = { data, mimeType, format, hash };

    cacheSet(hash, result);
    return { ...result, fromCache: false };

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Santé
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', cache: cache.size });
});

// Rendu principal
// POST /render
// Body: { code: string, format?: 'svg' | 'png' }
// Retourne: SVG ou PNG binaire
app.post('/render', async (req, res) => {
  const { code, format = 'svg' } = req.body ?? {};

  const validationError = validateLy(code);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (!['svg', 'png'].includes(format)) {
    return res.status(400).json({ error: 'format doit être "svg" ou "png".' });
  }

  try {
    const result = await compileLy(code, format);

    res.set({
      'Content-Type':  result.mimeType,
      'X-From-Cache':  result.fromCache ? 'true' : 'false',
      'X-Score-Hash':  result.hash,
      'Cache-Control': 'public, max-age=600',
    });

    return res.send(result.data);

  } catch (err) {
    const msg = err.stderr ?? err.message ?? 'Erreur inconnue';

    // Erreur LilyPond (syntaxe) vs erreur serveur
    if (err.code === 1 || /error:/i.test(msg)) {
      return res.status(422).json({
        error: 'Erreur de compilation LilyPond.',
        details: msg.slice(0, 1000),
      });
    }

    console.error('[LilyPond] Erreur inattendue:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── Démarrage ───────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001');
app.listen(PORT, () => {
  console.log(`[Harmonia LilyPond Service] Écoute sur le port ${PORT}`);
  console.log(`  LilyPond : ${LILYPOND_BIN}`);
  console.log(`  Timeout  : ${TIMEOUT_MS}ms`);
  console.log(`  CORS     : ${process.env.ALLOWED_ORIGINS ?? 'localhost:3000 + getharmonia.app'}`);
});

module.exports = app;

'use strict';

// Test d'intégration — lance le serveur, envoie des requêtes, vérifie les réponses
// Usage: node test/render.test.js

const http = require('http');

const PORT     = 3099; // port dédié aux tests
const BASE_URL = `http://localhost:${PORT}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port: PORT, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ─── Code LilyPond de test ────────────────────────────────────────────────────

const VALID_LY = `
\\version "2.24.0"
\\paper { paper-width = 120\\mm paper-height = 60\\mm indent = 0 }
\\score {
  \\new Staff {
    \\clef treble \\key c \\major \\time 4/4
    c'1 e' g' c''
  }
}
`;

const INVALID_LY = `
\\version "2.24.0"
\\score { \\new Staff { SYNTAX_ERROR_HERE } }
`;

const DANGEROUS_LY = `
\\version "2.24.0"
#(system "rm -rf /")
`;

// ─── Lancement du serveur de test ─────────────────────────────────────────────

process.env.PORT          = String(PORT);
process.env.COMPILE_TIMEOUT = '20000';
process.env.RATE_LIMIT    = '100';

const app = require('../src/server');

// Attendre que le serveur écoute
setTimeout(async () => {
  console.log('\n=== Harmonia LilyPond Service — Tests ===\n');

  // ── 1. Santé ────────────────────────────────────────────────────────────────
  console.log('1. GET /health');
  const health = await get('/health');
  assert('status 200',          health.status === 200);
  assert('body JSON valide',    health.body.includes('"status":"ok"'));

  // ── 2. Rendu SVG valide ─────────────────────────────────────────────────────
  console.log('\n2. POST /render — SVG valide');
  const svgRes = await post('/render', { code: VALID_LY, format: 'svg' });
  assert('status 200',          svgRes.status === 200);
  assert('Content-Type svg',    svgRes.headers['content-type']?.includes('svg'));
  assert('corps SVG non vide',  svgRes.body.length > 500);
  assert('header hash présent', !!svgRes.headers['x-score-hash']);

  // ── 3. Cache ────────────────────────────────────────────────────────────────
  console.log('\n3. Cache — deuxième requête identique');
  const svgRes2 = await post('/render', { code: VALID_LY, format: 'svg' });
  assert('status 200',          svgRes2.status === 200);
  assert('X-From-Cache: true',  svgRes2.headers['x-from-cache'] === 'true');
  assert('même hash',           svgRes2.headers['x-score-hash'] === svgRes.headers['x-score-hash']);

  // ── 4. Rendu PNG valide ─────────────────────────────────────────────────────
  console.log('\n4. POST /render — PNG valide');
  const pngRes = await post('/render', { code: VALID_LY, format: 'png' });
  assert('status 200',          pngRes.status === 200);
  assert('Content-Type png',    pngRes.headers['content-type']?.includes('png'));
  assert('magic bytes PNG',     pngRes.body.slice(0, 4).toString('hex') === '89504e47');

  // ── 5. Erreur syntaxe LilyPond ──────────────────────────────────────────────
  console.log('\n5. POST /render — syntaxe LilyPond invalide');
  const errRes = await post('/render', { code: INVALID_LY, format: 'svg' });
  assert('status 422',          errRes.status === 422);
  assert('body JSON erreur',    errRes.body.toString().includes('error'));

  // ── 6. Directive dangereuse ─────────────────────────────────────────────────
  console.log('\n6. POST /render — directive interdite');
  const danRes = await post('/render', { code: DANGEROUS_LY, format: 'svg' });
  assert('status 400',          danRes.status === 400);
  assert('message interdite',   danRes.body.toString().includes('interdit'));

  // ── 7. Code manquant ────────────────────────────────────────────────────────
  console.log('\n7. POST /render — body vide');
  const emptyRes = await post('/render', {});
  assert('status 400',          emptyRes.status === 400);

  // ── 8. Format invalide ──────────────────────────────────────────────────────
  console.log('\n8. POST /render — format invalide');
  const fmtRes = await post('/render', { code: VALID_LY, format: 'pdf' });
  assert('status 400',          fmtRes.status === 400);

  // ── Résultats ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Résultats : ${passed} passés, ${failed} échoués`);
  process.exit(failed > 0 ? 1 : 0);

}, 800);

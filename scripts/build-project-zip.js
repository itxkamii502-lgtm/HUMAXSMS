import fs from 'fs';
import path from 'path';
import vm from 'vm';
import AdmZip from 'adm-zip';
import { minify as terserMinify } from 'terser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Date stamp YYYYMMDD
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const dateStr = `${year}${month}${day}`;

const DIST_DIR = path.join(ROOT_DIR, 'dist');
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// Clean up older vps zips in dist/
const oldZips = fs.readdirSync(DIST_DIR).filter(f => f.startsWith('humex-sms-vps-') && f.endsWith('.zip'));
for (const oldZip of oldZips) {
  try {
    fs.unlinkSync(path.join(DIST_DIR, oldZip));
    console.log(`Cleaned older build archive: dist/${oldZip}`);
  } catch (e) {}
}

const OUTPUT_ZIP = path.join(DIST_DIR, `humex-sms-vps-${dateStr}.zip`);

// Strict Whitelist
const ROOT_FILES_WHITELIST = [
  'server.js',
  'ecosystem.config.cjs',
  'reset-owner-password.js',
  '.env.example',
  'README.md',
  'VPS_DEPLOYMENT_GUIDE.md',
  'scripts/backup-vps.sh'
];

// Production-only package.json with the 8 proven runtime dependencies
const RUNTIME_PKG = {
  name: 'humex-sms',
  private: true,
  version: '1.0.0',
  type: 'module',
  scripts: {
    start: 'node server.js --port 3000',
    lint: 'node --check server.js'
  },
  dependencies: {
    'adm-zip': '^0.6.1',
    'bcryptjs': '^3.0.3',
    'compression': '^1.8.2',
    'express': '^4.21.2',
    'multer': '^2.4.0',
    'qrcode': '^1.5.4',
    'smpp': '0.5.0',
    'ws': '^8.18.0'
  }
};

function minifyCssSafe(cssText) {
  return cssText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function stripHtmlCommentsSafe(htmlText) {
  return htmlText.replace(/<!--[\s\S]*?-->/g, '');
}

async function minifyJsSafe(code, relPath) {
  const result = await terserMinify(code, {
    compress: {
      drop_console: true,
      drop_debugger: true,
      dead_code: true,
      passes: 2
    },
    mangle: {
      toplevel: false
    },
    format: {
      comments: false,
      ascii_only: false
    }
  });
  if (!result || !result.code) {
    throw new Error(`Terser returned empty output for ${relPath}`);
  }
  // Compile-check every minified JS file to guarantee zero syntax issues
  new vm.Script(result.code, { filename: relPath });
  return result.code;
}

async function build() {
  console.log(`Building hardened production package: dist/humex-sms-vps-${dateStr}.zip...`);
  const zip = new AdmZip();

  // 1. Add whitelisted root files directly from workspace
  for (const rel of ROOT_FILES_WHITELIST) {
    const fullPath = path.join(ROOT_DIR, rel);
    if (fs.existsSync(fullPath)) {
      const buf = fs.readFileSync(fullPath);
      zip.addFile(rel, buf);
      console.log(`  + [WHITELIST] ${rel}`);
    } else {
      console.warn(`  ! [MISSING] Whitelisted file not found: ${rel}`);
    }
  }

  // 2. Add pruned runtime-only package.json
  const pkgJsonStr = JSON.stringify(RUNTIME_PKG, null, 2) + '\n';
  zip.addFile('package.json', Buffer.from(pkgJsonStr, 'utf8'));
  console.log('  + [RUNTIME PKG] package.json (8 runtime dependencies)');

  // 3. Add humex-sms/static/** with production JS minification/mangling & CSS/HTML comment stripping
  const staticDir = path.join(ROOT_DIR, 'humex-sms', 'static');
  let jsCount = 0;
  let jsRawBytes = 0;
  let jsMinBytes = 0;
  let cssCount = 0;
  let htmlCount = 0;

  async function addStaticFiles(dir, subDir = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relZipPath = subDir ? `${subDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await addStaticFiles(full, relZipPath);
      } else if (entry.isFile()) {
        if (
          entry.name.endsWith('.tmp') ||
          entry.name.endsWith('.bak') ||
          entry.name.endsWith('.zip') ||
          entry.name.endsWith('.map')
        ) {
          continue;
        }
        const rawBuf = fs.readFileSync(full);
        const lower = entry.name.toLowerCase();

        if (lower.endsWith('.js') && !lower.endsWith('.min.js')) {
          const rawStr = rawBuf.toString('utf8');
          const minStr = await minifyJsSafe(rawStr, relZipPath);
          const minBuf = Buffer.from(minStr, 'utf8');
          zip.addFile(`humex-sms/static/${relZipPath}`, minBuf);
          jsCount++;
          jsRawBytes += rawBuf.length;
          jsMinBytes += minBuf.length;
        } else if (lower.endsWith('.css') && !lower.endsWith('.min.css')) {
          const minCss = minifyCssSafe(rawBuf.toString('utf8'));
          zip.addFile(`humex-sms/static/${relZipPath}`, Buffer.from(minCss, 'utf8'));
          cssCount++;
        } else if (lower.endsWith('.html')) {
          const cleanHtml = stripHtmlCommentsSafe(rawBuf.toString('utf8'));
          zip.addFile(`humex-sms/static/${relZipPath}`, Buffer.from(cleanHtml, 'utf8'));
          htmlCount++;
        } else {
          zip.addFile(`humex-sms/static/${relZipPath}`, rawBuf);
        }
      }
    }
  }

  if (fs.existsSync(staticDir)) {
    await addStaticFiles(staticDir);
    const savedPct = jsRawBytes > 0 ? (((jsRawBytes - jsMinBytes) / jsRawBytes) * 100).toFixed(1) : '0.0';
    console.log(`  + [JS HARDENED] ${jsCount} files minified/mangled & console stripped (${(jsRawBytes / 1024).toFixed(1)} KB -> ${(jsMinBytes / 1024).toFixed(1)} KB, -${savedPct}%)`);
    console.log(`  + [CSS/HTML CLEANED] ${cssCount} CSS files minified, ${htmlCount} HTML files stripped of comments`);
  } else {
    throw new Error('Static directory not found at humex-sms/static');
  }

  zip.writeZip(OUTPUT_ZIP);
  const stat = fs.statSync(OUTPUT_ZIP);
  console.log(`\nSuccessfully created hardened production package:`);
  console.log(`  Destination: ${OUTPUT_ZIP}`);
  console.log(`  Package Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB (${stat.size} bytes)`);
}

build().catch(err => {
  console.error('Error building production package:', err);
  process.exit(1);
});

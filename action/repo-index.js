const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const https = require('https');

const INDEX_DIR = '.issue2claude';
const INDEX_FILE = 'embeddings.json';
const CHUNK_MAX_LINES = 60;
const SUPPORTED_EXTENSIONS = [
  '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.css', '.scss', '.html', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.md',
];

const IGNORE_DIRS = [
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'vendor', '__pycache__', '.issue2claude', 'coverage',
  '.turbo', '.cache', '.parcel-cache',
];

/**
 * Call OpenAI Embeddings API.
 */
function getEmbeddings(texts, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      input: texts,
      model: 'text-embedding-3-small',
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`OpenAI API error: ${parsed.error.message}`));
            return;
          }
          const embeddings = parsed.data
            .sort((a, b) => a.index - b.index)
            .map(d => d.embedding);
          resolve(embeddings);
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Dot product of two vectors (= cosine similarity for normalized vectors).
 */
function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Walk directory and collect code files.
 */
function walkDir(dir, baseDir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
      files.push(...walkDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        files.push(relPath);
      }
    }
  }

  return files;
}

/**
 * Split a file into chunks (by functions/classes or fixed line blocks).
 */
function chunkFile(filePath, content) {
  const lines = content.split('\n');
  const chunks = [];

  // For small files, one chunk
  if (lines.length <= CHUNK_MAX_LINES) {
    chunks.push({
      file: filePath,
      startLine: 1,
      endLine: lines.length,
      content: content.slice(0, 3000),
    });
    return chunks;
  }

  // Split by function/class boundaries or fixed blocks
  let chunkStart = 0;
  while (chunkStart < lines.length) {
    let chunkEnd = Math.min(chunkStart + CHUNK_MAX_LINES, lines.length);

    // Try to find a natural break point (empty line, function start)
    if (chunkEnd < lines.length) {
      for (let i = chunkEnd; i > chunkStart + 20; i--) {
        if (lines[i] && (lines[i].trim() === '' || lines[i].match(/^(export |async |function |class |def |fn |pub |const |let )/))) {
          chunkEnd = i;
          break;
        }
      }
    }

    const chunkContent = lines.slice(chunkStart, chunkEnd).join('\n');
    if (chunkContent.trim()) {
      chunks.push({
        file: filePath,
        startLine: chunkStart + 1,
        endLine: chunkEnd,
        content: chunkContent.slice(0, 3000),
      });
    }

    chunkStart = chunkEnd;
  }

  return chunks;
}

/**
 * Build the full index of the repository.
 */
async function buildIndex(repoDir, apiKey) {
  core.info('Building repo context index...');

  const files = walkDir(repoDir, repoDir);
  core.info(`Found ${files.length} code files`);

  // Chunk all files
  const allChunks = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(repoDir, file), 'utf-8');
      if (content.length > 100000) continue; // Skip huge files
      const chunks = chunkFile(file, content);
      allChunks.push(...chunks);
    } catch {
      // Skip unreadable files
    }
  }

  core.info(`Created ${allChunks.length} chunks from ${files.length} files`);

  if (allChunks.length === 0) {
    core.warning('No chunks to index');
    return { chunks: [], version: Date.now() };
  }

  // Batch embed (OpenAI supports up to 2048 inputs per request, but keep batches smaller)
  const BATCH_SIZE = 100;
  const embeddings = [];

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => `${c.file}:${c.startLine}\n${c.content}`);

    core.info(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)} (${batch.length} chunks)`);

    const batchEmbeddings = await getEmbeddings(texts, apiKey);
    embeddings.push(...batchEmbeddings);
  }

  // Build index
  const index = {
    version: Date.now(),
    model: 'text-embedding-3-small',
    chunks: allChunks.map((chunk, i) => ({
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      preview: chunk.content.slice(0, 200),
      embedding: embeddings[i],
    })),
  };

  // Save to repo
  const indexDir = path.join(repoDir, INDEX_DIR);
  fs.mkdirSync(indexDir, { recursive: true });
  const indexPath = path.join(indexDir, INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index));

  const sizeMB = (Buffer.byteLength(JSON.stringify(index)) / 1024 / 1024).toFixed(1);
  core.info(`Index saved: ${index.chunks.length} chunks, ${sizeMB} MB`);

  return index;
}

/**
 * Load existing index from repo.
 */
function loadIndex(repoDir) {
  const indexPath = path.join(repoDir, INDEX_DIR, INDEX_FILE);
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Search the index for chunks relevant to a query.
 */
async function searchIndex(query, index, apiKey, topK = 15) {
  if (!index || !index.chunks || index.chunks.length === 0) return [];

  // Embed the query
  const [queryEmbedding] = await getEmbeddings([query], apiKey);

  // Compute similarities
  const scored = index.chunks.map((chunk, i) => ({
    ...chunk,
    score: dotProduct(queryEmbedding, chunk.embedding),
  }));

  // Sort by similarity, return top K
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(({ embedding, ...rest }) => rest);
}

/**
 * Format search results as context for the prompt.
 */
function formatContext(results) {
  if (!results || results.length === 0) return '';

  const lines = ['### Relevant code (from repo index)'];
  for (const r of results) {
    lines.push(`\n**${r.file}** (lines ${r.startLine}-${r.endLine}, relevance: ${(r.score * 100).toFixed(0)}%)`);
    lines.push('```');
    lines.push(r.preview);
    lines.push('```');
  }

  return lines.join('\n');
}

module.exports = { buildIndex, loadIndex, searchIndex, formatContext, getEmbeddings, dotProduct };

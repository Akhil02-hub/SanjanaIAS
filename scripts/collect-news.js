#!/usr/bin/env node
/* SanjanaIAS news collector.
   Zero dependencies. Node 20+.
   Reads seeds and modules from ../app.js, fetches enabled feeds,
   deduplicates, classifies, scores relevance and writes:
     data/news.json   (machine-readable; read by the frontend)
     data/health.json (per-source status)
   Curated topics are preserved; auto topics older than 60 days are pruned. */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const {
    SI_RSS: RSS,
    SI_CLASSIFY: CLASSIFY,
    SI_DEDUPE: DEDUPE,
    SI_RELEVANCE: RELEVANCE,
    SEED_NEWS,
    SEED_SOURCES,
    ILLUSTRATIONS
} = require('../app.js');

function loadNews() {
    const jsonPath = path.join(DATA, 'news.json');
    if (fs.existsSync(jsonPath)) {
        try { return JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(SEED_NEWS));
}

function loadSources() {
    const jsonPath = path.join(DATA, 'sources.json');
    if (fs.existsSync(jsonPath)) {
        try { return JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { }
    }
    return SEED_SOURCES;
}

async function fetchText(url, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
            }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function summarise(text, max) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    const at = cut.lastIndexOf(' ');
    return (at > max * 0.6 ? cut.slice(0, at) : cut).trim() + '…';
}

function buildTopic(group, source) {
    const lead = group.lead;
    const cls = CLASSIFY.classify(lead);
    const rel = RELEVANCE.score({ title: lead.title, summary: lead.description, tags: cls.tags, gsPapers: cls.gsPapers });
    if (rel.excluded) return null;

    const sources = group.items.slice(0, 4).map(item => ({
        title: item.title,
        publisher: source.name,
        url: item.link,
        type: source.level === 'primary' ? 'primary' : 'reporting',
        date: item.published ? item.published.slice(0, 10) : null
    }));

    return {
        id: slug(lead.title).slice(0, 50) + '-' + (lead.published ? lead.published.slice(0, 10) : new Date().toISOString().slice(0, 10)),
        title: lead.title,
        region: cls.region,
        regions: cls.regions,
        category: cls.category,
        tags: cls.tags,
        gsPapers: cls.gsPapers,
        summary: summarise(lead.description || lead.title, 280),
        whyItMatters: '',
        image: lead.image || ILLUSTRATIONS[cls.region] || ILLUSTRATIONS.default,
        imageCredit: lead.image ? source.name : 'SanjanaIAS category illustration',
        readTime: Math.max(2, Math.round((lead.description || '').split(/\s+/).length / 200) + 3),
        published: (lead.published || new Date().toISOString()).slice(0, 10),
        updated: new Date().toISOString().slice(0, 10),
        importance: rel.score,
        importanceReason: rel.reasons.slice(0, 3).join(' '),
        curated: false,
        sources: sources,
        sections: {
            event: summarise(lead.description || lead.title, 600),
            background: '',
            causes: '',
            stakeholders: '',
            timeline: lead.published ? [{ date: lead.published.slice(0, 10), text: 'Reported by ' + source.name }] : [],
            data: [],
            geography: '',
            india: cls.regions.indexOf('india') > -1 ? 'Flagged as India-relevant by the classifier.' : '',
            telangana: cls.region === 'telangana' ? 'Telangana-specific item.' : '',
            challenges: '',
            solutions: '',
            upsc: 'Auto-tagged to ' + (cls.gsPapers.join(', ') || 'no paper') + '.',
            prelimsNotes: [],
            mainsNotes: []
        },
        prelimsQuestions: [],
        mainsQuestions: []
    };
}

async function main() {
    const registry = loadSources();
    const existing = loadNews();
    const now = new Date().toISOString();

    const curated = (existing.topics || []).filter(t => t.curated);
    const auto = (existing.topics || []).filter(t => !t.curated);
    const cutoff = Date.now() - 60 * 86400000;
    const fresh = auto.filter(t => new Date(t.published || 0).getTime() > cutoff);

    const health = { checked: now, sources: [], succeeded: 0, failed: 0, newTopics: 0 };
    const collected = [];

    for (const source of registry.sources) {
        if (!source.enabled || !source.feed) {
            health.sources.push({ id: source.id, name: source.name, status: 'not-configured', checked: now });
            continue;
        }
        try {
            const xml = await fetchText(source.feed);
            const items = RSS.parse(xml).slice(0, 25);
            if (!items.length) {
                health.sources.push({ id: source.id, name: source.name, status: 'no-new-articles', checked: now });
                continue;
            }
            const groups = DEDUPE.group(items, 0.55);
            let added = 0;
            for (const group of groups) {
                const candidate = buildTopic(group, source);
                if (!candidate) continue;
                const known = curated.concat(fresh).concat(collected).some(t =>
                    DEDUPE.isDuplicate(
                        { title: t.title, link: (t.sources && t.sources[0] && t.sources[0].url) || '' },
                        { title: candidate.title, link: candidate.sources[0] && candidate.sources[0].url },
                        0.6
                    ));
                if (!known) { collected.push(candidate); added++; }
            }
            health.sources.push({ id: source.id, name: source.name, status: 'ok', items: items.length, added, checked: now });
            health.succeeded++;
            health.newTopics += added;
        } catch (err) {
            console.error(`Failed ${source.name}:`, err.cause || err);
            health.sources.push({ id: source.id, name: source.name, status: 'failed', error: String(err.message || err), checked: now });
        }
    }

    const merged = curated.concat(collected, fresh).sort((a, b) => (b.importance || 0) - (a.importance || 0));

    // Only update the timestamp if topics actually changed
    const existingStr = JSON.stringify(existing.topics || []);
    const newStr = JSON.stringify(merged.slice(0, 400));
    const updatedTime = existingStr !== newStr ? now : (existing.updated || now);

    const payload = { updated: updatedTime, health, topics: merged.slice(0, 400) };

    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'news.json'), JSON.stringify(payload, null, 2) + '\n');

    // --- AUTO-GENERATE SITEMAP FOR GOOGLE BOTS ---
    const sitemapUrls = payload.topics.map(t => {
        return `  <url>
    <loc>https://sanjanaias.vercel.app/article/${t.id}</loc>
    <lastmod>${t.updated || t.published || new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;
    }).join('\n');

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls}
</urlset>`;

    fs.writeFileSync(path.join(ROOT, 'sitemap-articles.xml'), sitemapXml);
    console.log('✅ sitemap-articles.xml updated with ' + payload.topics.length + ' topics.');
    // ---------------------------------------------

    console.log('SanjanaIAS collector complete.');
    console.log('  sources ok:    ', health.succeeded);
    console.log('  sources failed:', health.failed);
    console.log('  new topics:    ', health.newTopics);
    console.log('  total topics:  ', payload.topics.length);
    console.log('  curated kept:  ', curated.length);

    if (health.succeeded === 0 && health.failed > 0) {
        console.error('All sources failed. Exiting non-zero so the workflow surfaces the problem.');
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
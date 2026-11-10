import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    // Get the article ID from the URL
    const { id } = req.query;

    try {
        // Read your local news.json file (or you can fetch from Supabase here)
        const dataPath = path.join(process.cwd(), 'data', 'news.json');
        const jsonData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

        // Find the specific topic
        const topic = jsonData.topics.find(t => t.id === id);

        if (!topic) {
            // If topic not found, return basic HTML
            return res.status(404).send('<h1>Topic not found</h1>');
        }

        // Build the HTML specifically for bots
        const html = `
<!doctype html>
<html lang="en-IN">
<head>
    <meta charset="utf-8">
    <title>${topic.title} · SanjanaIAS</title>
    <meta name="description" content="${topic.summary || topic.whyItMatters}">
    <meta name="robots" content="index, follow">
    
    <!-- Open Graph for WhatsApp, LinkedIn, Twitter -->
    <meta property="og:type" content="article">
    <meta property="og:title" content="${topic.title}">
    <meta property="og:description" content="${topic.summary || topic.whyItMatters}">
    <meta property="og:image" content="https://sanjanaias.vercel.app/logo.png">
    <meta property="og:url" content="https://sanjanaias.vercel.app/article/${id}">
    
    <meta name="twitter:card" content="summary_large_image">
</head>
<body>
    <!-- This text is what AI models and Search Engines will read -->
    <h1>${topic.title}</h1>
    <p><strong>Region:</strong> ${topic.region}</p>
    <p><strong>Category:</strong> ${topic.category}</p>
    <p><strong>GS Papers:</strong> ${(topic.gsPapers || []).join(', ')}</p>
    
    <h2>Summary</h2>
    <p>${topic.summary}</p>
    
    <h2>Why it matters for UPSC</h2>
    <p>${topic.whyItMatters || ''}</p>
    
    ${topic.sections && topic.sections.background ? `<h2>Background</h2><p>${topic.sections.background}</p>` : ''}
    ${topic.sections && topic.sections.india ? `<h2>India's Perspective</h2><p>${topic.sections.india}</p>` : ''}
    
    <hr>
    <a href="https://sanjanaias.vercel.app/article/${id}">Read the full interactive version on SanjanaIAS</a>
</body>
</html>
        `;

        // Send the HTML to the bot
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
        return res.status(200).send(html);

    } catch (error) {
        console.error(error);
        return res.status(500).send('<h1>Server Error</h1>');
    }
}
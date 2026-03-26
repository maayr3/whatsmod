const fetch = require('node-fetch');

class YouTubeService {
    /**
     * Extracts video ID from various YouTube URL formats.
     */
    extractVideoId(url) {
        if (!url) return null;
        const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    /**
     * Fetches basic metadata (title, author) via YouTube's oEmbed API.
     */
    async getMetadata(url) {
        try {
            const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const response = await fetch(oEmbedUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
            });
            if (!response.ok) return null;
            const data = await response.json();
            return {
                title: data.title,
                author: data.author_name,
                thumbnailUrl: data.thumbnail_url
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Downloads the thumbnail and returns it as base64.
     */
    async getThumbnailBase64(videoId) {
        try {
            const thumbnailUrls = [
                `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
            ];

            for (const url of thumbnailUrls) {
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                });
                if (response.ok) {
                    const buffer = await response.buffer();
                    return {
                        mimeType: 'image/jpeg',
                        base64: buffer.toString('base64')
                    };
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Fetches the transcript of a YouTube video using a direct fetch approach.
     */
    async getTranscript(videoId) {
        try {
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const response = await fetch(videoUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            const html = await response.text();

            // More robust extraction for captionTracks
            if (!html.includes('captionTracks')) return null;

            const regex = /"captionTracks":\s*(\[.+?\])/;
            const match = html.match(regex);
            if (!match) return null;

            let captionTracks;
            try {
                // Try balancing braces to get exactly the array
                let str = match[1];
                let depth = 0;
                let endIdx = 0;
                for (let i = 0; i < str.length; i++) {
                    if (str[i] === '[') depth++;
                    else if (str[i] === ']') depth--;
                    if (depth === 0) {
                        endIdx = i + 1;
                        break;
                    }
                }
                captionTracks = JSON.parse(str.substring(0, endIdx));
            } catch (e) {
                return null;
            }

            if (!captionTracks || !captionTracks.length) return null;

            // Prefer English (en) or English US (en-US)
            const track = captionTracks.find(t => t.languageCode === 'en' || t.languageCode === 'en-US') || captionTracks[0];
            const trackUrl = track.baseUrl;
            
            const transcriptResponse = await fetch(trackUrl);
            const transcriptXml = await transcriptResponse.text();

            // Extract text content from XML
            const textMatches = transcriptXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g);
            let fullText = '';
            for (const match of textMatches) {
                let text = match[1]
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&apos;/g, "'");
                fullText += text + ' ';
            }

            fullText = fullText.trim();
            if (!fullText) return null;

            return fullText.length > 3000 ? fullText.substring(0, 3000) + '...' : fullText;
        } catch (e) {
            return null;
        }
    }
}

module.exports = new YouTubeService();

const YouTubeService = require('../bot/youtube');

async function testEnrichment() {
    const testUrl = 'https://youtube.com/shorts/4z3dFX0ec9M?si=XgBccZtZyycxe0Ik';
    console.log(`Testing enrichment for: ${testUrl}`);

    const videoId = YouTubeService.extractVideoId(testUrl);
    console.log(`Video ID: ${videoId}`);

    if (!videoId) {
        console.error('Failed to extract video ID');
        return;
    }

    console.log('\n--- Metadata ---');
    const metadata = await YouTubeService.getMetadata(testUrl);
    console.log(JSON.stringify(metadata, null, 2));

    console.log('\n--- Thumbnail ---');
    const thumbnail = await YouTubeService.getThumbnailBase64(videoId);
    if (thumbnail) {
        console.log(`Thumbnail fetched! Mime: ${thumbnail.mimeType}, Base64 length: ${thumbnail.base64.length}`);
    } else {
        console.log('Failed to fetch thumbnail');
    }

    console.log('\n--- Transcript ---');
    const transcript = await YouTubeService.getTranscript(videoId);
    if (transcript) {
        console.log(`Transcript fetched! Length: ${transcript.length}`);
        console.log(`Preview: ${transcript.substring(0, 200)}...`);
    } else {
        console.log('No transcript available or failed to fetch');
    }
}

testEnrichment().catch(console.error);

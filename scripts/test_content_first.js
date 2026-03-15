require('dotenv').config();
const LLMService = require('../bot/llm');

async function test() {
    const llm = new LLMService();
    const channelName = "WarRoom";

    // Mock user stats for "Doug" with a bad history of junk media
    const userStats = {
        "Doug": [
            { timestamp: "2026-03-15T07:36:10.287Z", reason: "Harassment and aggressive conduct towards the moderator." },
            { timestamp: "2026-03-15T08:36:01.533Z", reason: "Repeatedly posting unverified Instagram Reels as 'tech content' to bypass moderation." },
            { timestamp: "2026-03-15T08:41:02.540Z", reason: "Repeated posting of junk media despite multiple recorded warnings." }
        ]
    };

    // Mock transcript where Doug posts the high-value CES reel WITHOUT a caption
    const transcript = [
        "Alice: Did anyone see the news about the new battery tech?",
        "Bob: Yeah, looks promising for EVs.",
        "Doug: https://www.instagram.com/reel/DTn4bhijDgf/"
    ];

    console.log("Testing high-value content from 'Doug' (high offense history)...");

    try {
        const result = await llm.evaluate(channelName, transcript, [], userStats);
        console.log("\nLLM Result (with stats):");
        console.log(JSON.stringify(result, null, 2));

        if (result.violation === false) {
            console.log("\n✅ SUCCESS: High-value content correctly classified as NOT a violation.");
        } else {
            console.log("\n❌ FAILURE: High-value content was incorrectly flagged as a violation.");
        }

        console.log("\n--- CONTROL TEST (NO STATS) ---");
        const controlResult = await llm.evaluate(channelName, transcript, [], {});
        console.log("\nLLM Result (no stats):");
        console.log(JSON.stringify(controlResult, null, 2));

        if (controlResult.violation === false) {
            console.log("\n✅ SUCCESS: Content classified correctly when stats are hidden.");
        } else {
            console.log("\n❌ FAILURE: Content STILL classified as junk even without stats.");
        }

        if (result.classification_analysis) {
            console.log(`\nAnalysis: ${result.classification_analysis}`);
        }
    } catch (err) {
        console.error("Test failed with error:", err);
    }
}

test();

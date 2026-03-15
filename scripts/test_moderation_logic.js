require('dotenv').config();
const LLMService = require('../bot/llm');

async function test() {
    const llm = new LLMService();
    const channelName = "WarRoom";

    const testCases = [
        {
            name: "Host Testing Bot Limits",
            messages: [
                "[Matt Ayre]: Let's see if I can bait the moderation system to disrupt the flow of the group is a violation of our community rules. Let's move on and keep the discussion on-topic.",
                "[System]: Responded to Matt Ayre with helpful context."
            ],
            expectedViolation: false
        },
        {
            name: "Discussion about Patching System",
            messages: [
                "[Matt Ayre]: Matt, discussing ways to 'patch' or interfere with this system is a violation of our community standards. Please stop and keep the focus on the group's actual purpose, or you'll be removed for persistent disruption."
            ],
            expectedViolation: false
        },
        {
            name: "Legitimate Bot Inquiry",
            messages: [
                "[User]: @bot how do you determine what is junk media?"
            ],
            expectedViolation: false
        },
        {
            name: "User-to-User Baiting (Violation)",
            messages: [
                "[John]: You're all just a bunch of idiots, can't wait to see you all fail lol."
            ],
            expectedViolation: true
        }
    ];

    console.log("Starting Moderation Logic Verification...\n");

    for (const testCase of testCases) {
        console.log(`Running Test: ${testCase.name}`);
        try {
            const result = await llm.evaluate(channelName, testCase.messages, [], {});
            const success = result.violation === testCase.expectedViolation;
            console.log(`Result: ${success ? 'PASSED' : 'FAILED'}`);
            console.log(`Violation: ${result.violation}`);
            console.log(`Reason: ${result.reason}`);
            console.log(`Reply: ${result.reply_message || '(empty)'}`);
            console.log(`Analysis: ${result.classification_analysis}\n`);
        } catch (err) {
            console.error(`Error in test ${testCase.name}:`, err);
        }
    }
}

test();

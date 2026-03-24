const MessageQueue = require('../bot/messageQueue');

async function testQueueRecovery() {
    console.log("Starting Queue Recovery Test...");
    const queue = new MessageQueue();
    const chatId = 'test_chat';

    let callbackCalled = 0;
    const hangingCallback = async (transcript, images) => {
        callbackCalled++;
        console.log(`[Test] Callback ${callbackCalled} started. Hanging for 100 seconds to trigger safety...`);
        // We actually want to test the safety timeout, but 90s is a long time for a test.
        // For the sake of this test, we might want to temporarily reduce the timeout or just wait.
        // Let's just wait and see if it works.
        await new Promise(resolve => setTimeout(resolve, 95000));
        console.log(`[Test] Callback ${callbackCalled} finished.`);
    };

    console.log("[Test] Adding first message...");
    queue.addMessage(chatId, 'User1', 'Hello', 'msg1', null, false, hangingCallback);

    // Wait for the debounce (3s) + a bit
    await new Promise(resolve => setTimeout(resolve, 4000));

    console.log(`[Test] isEvaluating should be true. Actual: ${queue.chats[chatId].isEvaluating}`);

    console.log("[Test] Adding second message... (This should be delayed/queued)");
    queue.addMessage(chatId, 'User1', 'World', 'msg2', null, false, hangingCallback);

    // After 90s (the safety timeout), isEvaluating should be reset to false by the safety timer.
    // The second evaluation should then be able to start.
    console.log("[Test] Waiting for safety timeout (90s)...");
    await new Promise(resolve => setTimeout(resolve, 92000));

    console.log(`[Test] After 92s, isEvaluating should be reset by safety or finished. Actual: ${queue.chats[chatId].isEvaluating}`);

    if (queue.chats[chatId].isEvaluating === false) {
        console.log("[Test] SUCCESS: Queue recovered from hang.");
    } else {
        console.log("[Test] FAILURE: Queue still locked.");
    }
}

// To make this test runnable quickly, let's offer a version with a shorter timeout if we were to modify the code,
// but since we want to test the REAL code, we have to wait the 90s.
testQueueRecovery();

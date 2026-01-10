// scripts/measureConcurrency.js
const util = require('util');
util.isNullOrUndefined = util.isNullOrUndefined || ((value) => value === null || value === undefined);

const { transactionService, intentService } = {
    transactionService: require('../src/services/ai/transactionService'),
    intentService: require('../src/services/ai/intentService')
};
const knowledgeBase = require('../src/models/knowledgeBase');

async function measure() {
    console.log('Initializing...');
    knowledgeBase.loadKnowledgeBase();
    await transactionService.loadTransactionModel();
    await intentService.loadIntentModel();

    const startMem = process.memoryUsage().rss / 1024 / 1024;
    console.log(`Base Memory: ${startMem.toFixed(2)} MB`);

    const concurrentUsers = 15;
    console.log(`Simulating ${concurrentUsers} concurrent AI requests...`);

    const tasks = [];
    for (let i = 0; i < concurrentUsers; i++) {
        tasks.push(intentService.predictIntent('how do i save money for a car?'));
        tasks.push(transactionService.predictTransaction('bought coffee for 5 dollars'));
    }

    // Measure memory while tasks are running (as much as possible in JS)
    const interval = setInterval(() => {
        const currentMem = process.memoryUsage().rss / 1024 / 1024;
        process.stdout.write(`\rCurrent Memory: ${currentMem.toFixed(2)} MB (Max: 512 MB)`);
    }, 100);

    await Promise.all(tasks);
    clearInterval(interval);

    const endMem = process.memoryUsage().rss / 1024 / 1024;
    console.log(`\nFinal Memory: ${endMem.toFixed(2)} MB`);
    process.exit(0);
}

measure().catch(err => {
    console.error(err);
    process.exit(1);
});

// scripts/measureMemory.js
const util = require('util');
util.isNullOrUndefined = util.isNullOrUndefined || ((value) => value === null || value === undefined);

const { transactionService, intentService } = {
    transactionService: require('../src/services/ai/transactionService'),
    intentService: require('../src/services/ai/intentService')
};
const knowledgeBase = require('../src/models/knowledgeBase');

async function measure() {
    const startMem = process.memoryUsage().rss / 1024 / 1024;
    console.log(`Initial Memory (RSS): ${startMem.toFixed(2)} MB`);

    console.log('Loading Knowledge Base...');
    knowledgeBase.loadKnowledgeBase();
    const kbMem = process.memoryUsage().rss / 1024 / 1024;
    console.log(`After KB: ${kbMem.toFixed(2)} MB (+ ${(kbMem - startMem).toFixed(2)} MB)`);

    console.log('Loading Transaction Model...');
    await transactionService.loadTransactionModel();
    const transMem = process.memoryUsage().rss / 1024 / 1024;
    console.log(`After Transaction Model: ${transMem.toFixed(2)} MB (+ ${(transMem - kbMem).toFixed(2)} MB)`);

    console.log('Loading Intent Model...');
    await intentService.loadIntentModel();
    const intentMem = process.memoryUsage().rss / 1024 / 1024;
    console.log(`After Intent Model: ${intentMem.toFixed(2)} MB (+ ${(intentMem - transMem).toFixed(2)} MB)`);

    console.log('Warming Up...');
    await transactionService.predictTransaction('test');
    await intentService.predictIntent('hello');
    const finalMem = process.memoryUsage().rss / 1024 / 1024;
    console.log(`Final Warm Memory: ${finalMem.toFixed(2)} MB (+ ${(finalMem - intentMem).toFixed(2)} MB)`);

    console.log('TOTAL_RSS:' + finalMem);
    process.exit(0);
}

measure().catch(err => {
    console.error(err);
    process.exit(1);
});

/******************************************************************************
 * evaluate.js - Test a trader against data
 *****************************************************************************/

const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');
const fs = require('fs-extra');
const path = require('path');

let tradersFolder = "./traders/";

const getAllTraders = function() {
    return new Promise((resolve, reject) => {
        fs.readdir("./traders/", (err, files) => {
            let traders = [];
            files.forEach(file => {
                //console.log(file);
                try {
                    if (file !== "trader.js" && file !== "evolve") {
                        let TraderConstructor = require('./' + path.join(tradersFolder, file));
                        traders.push(new TraderConstructor());
                    }
                } catch (e) {
                    console.error(`Error requiring trader ${file}`);
                }
            });
            resolve(traders);
        });
    });
}

const benchmark = async function() {
    let btcData = await csv.getData();
    let traders = await getAllTraders();

    console.log('[*] Traders:');
    for (let trader of traders) {
        console.log('  - ' + trader.hash());
    }

    console.log('[*] starting benchmark');
    for (let trader of traders) {
        console.log('   - evaluating trader: ' + trader.hash() + "...");
        try {
            await trader.initialize();
            await trader.trade(btcData);
        } catch (e) {
            console.error(`Exception when running trader ${trader.hash()}: ${e}`);
        }
    }

    console.log('[*] benchmark results:');
    let arrResults = [];
    let sortedTraders = _.sortBy(traders, t => t.statistics().cumulatedGain);
    sortedTraders = _.reverse(sortedTraders);
    for (let trader of sortedTraders) {
        let stats = trader.statisticsStr();

        // group all data in an array
        arrResults.push({
            name: trader.hash(),
            'gain': stats.cumulatedGain,
            'w/l': stats.winLossRatio,
            'avgROI': stats.avgROI,
            'pos': stats.trades.nbPositiveTrades,
            'neg': stats.trades.nbNegativeTrades,
        });
    }
    console.table(arrResults);
}

module.exports = benchmark;
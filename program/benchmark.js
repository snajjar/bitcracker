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
                if (file !== "trader.js" && file !== "evolve") {
                    let TraderConstructor = require('./' + path.join(tradersFolder, file));
                    traders.push(new TraderConstructor());
                }
            });
            resolve(traders);
        });
    });
}

const benchmark = async function(interval) {
    let btcData = await csv.getDataForInterval(interval);
    let traders = await getAllTraders();

    console.log('[*] Traders:');
    for (let trader of traders) {
        console.log('  - ' + trader.hash());
    }

    console.log('[*] starting benchmark');
    for (let trader of traders) {
        console.log('   - evaluating trader: ' + trader.hash() + "...");
        await trader.initialize(interval);
        await trader.trade(btcData);
    }

    console.log('[*] benchmark results:');
    let arrResults = [];
    let sortedTraders = _.sortBy(traders, t => t.gain());
    sortedTraders = _.reverse(sortedTraders);
    for (let trader of sortedTraders) {
        // group all data in an array
        arrResults.push({
            name: trader.hash(),
            gain: trader.gain().toFixed(0) + '€',
            "win ratio": (trader.winLossRatio() * 100).toFixed(2) + '%',
            "avg ROI": (trader.avgROI() * 100).toFixed(2) + "%",
            "trades": trader.trades.length,
            "pos": trader.nbPositiveTrades(),
            "neg": trader.nbNegativeTrades(),
        });
    }
    console.table(arrResults);
}

module.exports = benchmark;
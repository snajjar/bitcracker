/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/
const csv = require('./lib/csv');
const dt = require('./lib/datatools');
const moment = require('moment');

const accuracy = async function(model) {
    // load model class
    let Model = require('./models/prediction/' + model);
    let m = new Model();
    await m.initialize();
    m.createModel();
    await m.compile();

    // load data from CSV
    let btcData = await csv.getData();
    let acc = await m.accuracy(btcData);

    let percent = (n) => {
        return (n * 100).toFixed(2) + "%";
    }
    console.log(`[*] Model acc: min=${percent(acc.min)} avg=${percent(acc.avg)} max=${percent(acc.max)} inconsistent_predictions=${percent(acc.inconsistencies)}`);
}

module.exports = accuracy;
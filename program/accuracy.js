/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/
const csv = require('./lib/csv');
const dt = require('./lib/datatools');
const moment = require('moment');

const accuracy = async function(model, adjusted) {
    // load model class
    let Model = require('./models/prediction/' + model);
    let m = new Model();
    await m.load();

    // load data from CSV
    let btcData = await csv.getData();

    // accuracy fonction should print results
    let acc = await m.accuracy(btcData, adjusted);
}

module.exports = accuracy;
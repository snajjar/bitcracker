/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/
const csv = require('./lib/csv');

const train = async function(model, interval) {
    // load model class
    let Model = require('./models/prediction/' + model);
    let m = new Model();
    await m.initialize();
    m.createModel();
    await m.compile();

    // load data from CSV
    let btcData = await csv.getDataForInterval(interval);

    await m.train(btcData);
    await m.save(interval);
}

module.exports = train;
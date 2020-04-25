/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/
const csv = require('./lib/csv');
const dt = require('./lib/datatools');
const moment = require('moment');

const train = async function(args) {
    let model = args.model;
    let breakDate = args.breakDate || null;
    let lowMemory = args.lowMemory || false;

    // load model class
    let Model = require('./models/prediction/' + model);
    let m = new Model();
    await m.initialize();
    m.createModel();
    await m.compile();

    // load data from CSV
    let btcData = await csv.getData();

    if (breakDate) {
        let breakTimestamp = moment(breakDate, "DD/MM/YYYY").unix();
        let [trainData, testData] = dt.breakData(btcData, breakTimestamp);
        console.log(`[*] Train set : ${dt.rangeStr(trainData)}`);
        console.log(`[*] Test set : ${dt.rangeStr(testData)}`);

        if (lowMemory && m.trainLowMemory) {
            await m.trainLowMemory(trainData, testData)
        } else {
            await m.train(trainData, testData);
        }
    } else {
        console.log(`[*] Train set : ${dt.rangeStr(btcData)}`);
        if (lowMemory && m.trainLowMemory) {
            await m.trainLowMemory(btcData);
        } else {
            await m.train(btcData);
        }
    }

    await m.save();
}

module.exports = train;
/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const csv = require('./csv');

// base for Ichimoku indicator
// with 52, it will make 364 inputs
const nbPeriods = 52;

// We'll create a sequential model and train it on a set of nbPeriods period
// Each period will have the following informations:
// - open price
// - high price
// - low price
// - close price
// - vwap (volume weighted average price)
// - volume
// each of theses informations are processed through sigmoid function
const nbDataByPeriod = 6;

// The model will take an input of size nbPeriods * nbDataByPeriod
const nbDataInput = nbPeriods * nbDataByPeriod;

// The model will output a prediction for the next period
// - open price
// - high price
// - low price
// - close price
const nbDataOutput = 4;

// thoses values will have to be convert back from sigmoid (using logit function)
const model = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput, activation: 'sigmoid' }),
        tf.layers.dense({ units: nbDataOutput, activation: 'sigmoid' }),
    ]
});

model.compile({
    optimizer: 'adam',
    loss: 'meanSquaredError',
    metrics: ['accuracy']
});

const splitData = function(data) {
    // split our data into train data and test data
    let l = data.length;
    let limit = Math.round(data.length * 0.8);
    const trainData = data.slice(0, limit); // use 80% of our data to train
    const testData = data.slice(limit);

    console.log('[*] splitting data:');
    console.log(`[*]   train sample: size ${trainData.length}`);
    console.log(`[*]   test sample: size ${testData.length}`);

    return [trainData, testData];
}

const debug = function(o) {
    console.log(require('util').inspect(o));
}

const predict = function(periods) {
    const inputs = tf.tensor(periods);
    let outputs = model.predict(inputs);
    outputs.print();
}

const train = async function(data) {
    let inputs = [];
    let outputs = [];
    let nbSamples = 0;

    // build input and output tensors from data
    // input tensors are dimension 6
    // output tensors are dimension 4
    for (var i = 0; i < data.length - nbPeriods - 1; i++) {
        let sampleInputs = [];
        for (var j = 0; j < nbPeriods; j++) {
            let curData = data[i + j];
            sampleInputs.push(curData.open);
            sampleInputs.push(curData.high);
            sampleInputs.push(curData.low);
            sampleInputs.push(curData.close);
            sampleInputs.push(curData.vwap);
            sampleInputs.push(curData.volume);
        }

        inputs.push(sampleInputs);

        let outputData = data[i + nbPeriods];
        outputs.push([
            outputData.open,
            outputData.high,
            outputData.low,
            outputData.close,
        ]);
        nbSamples++;
    }

    // build our tensors
    //debug(inputs);
    let inputTensor = tf.tensor2d(inputs, [nbSamples, nbPeriods * nbDataByPeriod], 'float32');
    //inputTensor.print();

    //debug(outputs);
    let outputTensor = tf.tensor2d(outputs, [nbSamples, nbDataOutput], 'float32');
    //outputTensor.print();

    // train the model for each tensor
    const response = await model.fit(inputTensor, outputTensor, {
        shuffle: true,
        epochs: 50,
        batchsize: 50,
        validtionSplit: 0.2
    });
}


const main = async function() {
    // load data from CSV
    const btcData = await csv.fetchData('../data/btceur/Kraken_BTCEUR_1h.csv');
    //const [trainData, testData] = splitData(btcData);

    train(btcData);
    //test(testData);
}

main();
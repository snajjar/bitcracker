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
// - high price
// - low price
// - direction (SELLING or BUYING): is the open price > close price
const nbDataOutput = 3;
// Other ideas:
// - open price // DISABLED
// - close price // DISABLED


// thoses values will have to be convert back from sigmoid (using logit function)
const model = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput, activation: 'sigmoid' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: Math.round(nbDataInput * 0.5), activation: 'sigmoid' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: Math.round(nbDataInput * 0.25), activation: 'sigmoid' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: nbDataOutput, activation: 'sigmoid' }),
    ]
});

model.compile({
    optimizer: 'adam',
    loss: 'meanSquaredError',
    metrics: ['accuracy']
});

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
            //outputData.open,
            outputData.high,
            outputData.low,
            outputData.open > outputData.close ? 0 : 1
        ]);
        nbSamples++;
    }

    console.log(`[*] training AI on ${nbSamples} samples`);

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
        epochs: 40,
        batchsize: 50,
        validtionSplit: 0.25
    });

    tf.dispose(inputTensor);
    tf.dispose(outputTensor);
}


const main = async function() {
    // load data from CSV
    const btcData = await csv.fetchData('../data/btceur/Kraken_BTCEUR_1h.csv');

    await train(btcData);

    await model.save('file://./models/supervised/Kraken_BTCEUR_1h/');
}

main();
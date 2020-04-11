/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');

// number of periods of data we provide to the model to determine the output
const nbPeriods = 10; // 52: base for ichimoku indicator

const trainingOptions = {
    shuffle: true,
    epochs: 50,
    batchsize: 10,
    validtionSplit: 0.2
}

const nbDataInput = nbPeriods;
const nbDataOutput = 1;

// thoses values will have to be convert back from sigmoid (using logit function)
const model = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput, activation: 'relu' }),
        //tf.layers.dropout(0.8),
        tf.layers.dense({ units: nbDataInput, activation: 'relu' }),
        //tf.layers.dropout(0.8),
        tf.layers.dense({ units: nbDataOutput, activation: 'relu' }),
    ]
});

const adam = tf.train.adam(0.01);

model.compile({
    optimizer: adam,
    loss: 'meanSquaredError',
    metrics: ['accuracy']
});

const trainModel = async function(data) {
    let inputs = [];
    let outputs = [];

    // build input and output tensors from data
    for (var i = 0; i < data.length - nbPeriods - 1; i++) {
        // compute the input field from the first nbPeriods periods
        let sampleInputs = [];
        for (var j = 0; j < nbPeriods; j++) {
            let closePrice = data[i + j].close;
            sampleInputs.push(closePrice);
        }
        inputs.push(sampleInputs);

        // compute the output field with from the next period
        let sampleOutput = [];
        let outputClosePrice = data[i + nbPeriods].close;
        sampleOutput.push(outputClosePrice);
        outputs.push(sampleOutput);
    }

    // now, we got our sample, but we're like for increasing the model performance to work on the variations of theses data
    //let inputVariations = datatools.computeDataVariations(inputs);
    //let outputVariations = datatools.computeDataVariations(outputs);
    let nbSamples = outputs.length;

    console.log(`[*] training AI on ${nbSamples} samples`);

    // build our tensors
    let inputTensor = tf.tensor2d(inputs, [nbSamples, nbDataInput], 'float32');
    let outputTensor = tf.tensor2d(outputs, [nbSamples, nbDataOutput], 'float32');

    inputTensor.print();
    outputTensor.print();

    // train the model for each tensor
    const response = await model.fit(inputTensor, outputTensor, trainingOptions);

    tf.dispose(inputTensor);
    tf.dispose(outputTensor);
}

const train = async function(interval) {
    // load data from CSV
    let btcData = await csv.getDataForInterval(interval);

    await trainModel(btcData);
    await model.save(`file://./models/supervised/Cex_BTCEUR_${utils.intervalToStr(interval)}/`);
}

module.exports = train;
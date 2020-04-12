/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');
const datatools = require('./lib/datatools');

// number of periods of data we provide to the model to determine the output
const nbPeriods = 5;

// cap maximum variance per period to improve neural net's accuracy
const maxVariancePerPeriod = 0.01;

const trainingOptions = {
    shuffle: true,
    epochs: 10,
    batchsize: 10,
    validtionSplit: 0.2
}

const nbDataInput = nbPeriods;
const nbDataOutput = 1;

// thoses values will have to be convert back from sigmoid (using logit function)
const model = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput, activation: 'relu' }),
        tf.layers.dense({ units: nbDataInput, activation: 'relu' }),
        tf.layers.dense({ units: nbDataOutput, activation: 'relu' }),
    ]
});

const adam = tf.train.adam(0.01);

model.compile({
    optimizer: adam,
    loss: 'meanSquaredError',
    metrics: ['accuracy']
});

// variation is between [1-maxVariance, 1+maxVariance], map this to [0, 1]
let activateVariation = function(x) {
    return (x + maxVariancePerPeriod - 1) / (2 * maxVariancePerPeriod);
}

// output is between [0, 1], map this to [1-maxVariance, 1+maxVariance]
let deactivateVariation = function(x) {
    return y + 2 * maxVariancePerPeriod + 1 - maxVariancePerPeriod;
}

const trainModel = async function(data) {
    let inputs = [];
    let outputs = [];

    // build input and output tensors from data
    for (var i = 0; i < data.length - nbPeriods - 1; i++) {
        // compute the input field from the first nbPeriods periods
        let sampleInputs = [];
        for (var j = 0; j < nbPeriods; j++) {
            let closePrice = data[i + j].close;
            sampleInputs.push(activateVariation(closePrice));
        }
        inputs.push(sampleInputs);

        // compute the output field with from the next period
        let sampleOutput = [];
        let outputClosePrice = data[i + nbPeriods].close;
        sampleOutput.push(activateVariation(outputClosePrice));
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
    btcVariations = datatools.dataVariations(btcData, maxVariancePerPeriod);

    await trainModel(btcVariations);
    await model.save(`file://./models/supervised/Cex_BTCEUR_${utils.intervalToStr(interval)}_Variation/`);
}

module.exports = train;
/******************************************************************************
 * train.js - supervised training an AI over bitcoin prices
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const _ = require('lodash');
const csv = require('./csv');
const config = require('./config');
const utils = require('./utils');
const datatools = require('./datatools');

// The model will take an input of size nbPeriods * nbDataByPeriod
const nbDataInput = config.nbPeriods * config.nbDataByPeriod;

// The model will output a prediction for the next period
// - high price
// - low price

const nbDataOutput = 3;
// Other ideas:
// - open price // DISABLED
// - close price // DISABLED
// - direction (SELLING or BUYING): is the open price > close price // DISABLED

// thoses values will have to be convert back from sigmoid (using logit function)
const model = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [nbDataInput], units: 1024, activation: 'relu' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: 512, activation: 'relu' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: 256, activation: 'relu' }),
        tf.layers.dropout(0.8),
        tf.layers.dense({ units: nbDataOutput, activation: 'relu' }),
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

    // build input and output tensors from data
    // input tensors are dimension 6
    // output tensors are dimension 4
    // scale all value down by dividing by 1 000 000
    for (var i = 0; i < data.length - config.nbPeriods - 1; i++) {
        let sampleInputs = [];
        for (var j = 0; j < config.nbPeriods; j++) {
            let curData = data[i + j];
            sampleInputs.push(utils.priceScaleDown(curData.open));
            sampleInputs.push(utils.priceScaleDown(curData.high));
            sampleInputs.push(utils.priceScaleDown(curData.low));
            sampleInputs.push(utils.priceScaleDown(curData.close));
            sampleInputs.push(utils.priceScaleDown(curData.vwap));
            //sampleInputs.push(curData.volume / config.scalePrice);
        }

        inputs.push(sampleInputs);

        let outputData = data[i + config.nbPeriods];
        outputs.push([
            utils.priceScaleDown(outputData.close),
            utils.priceScaleDown(outputData.low), // low value
            utils.priceScaleDown(outputData.high), // high value
            //outputData.open > outputData.close ? 0 : 1
        ]);
    }

    // now, we got our sample, but we're like for increasing the model performance to work on the variations of theses data
    //let inputVariations = datatools.computeDataVariations(inputs);
    //let outputVariations = datatools.computeDataVariations(outputs);
    let nbSamples = outputs.length;

    console.log(`[*] training AI on ${nbSamples} samples`);

    // build our tensors
    // let inputTensor = tf.tensor2d(inputVariations, [nbSamples, config.nbPeriods * config.nbDataByPeriod], 'float32');
    // let outputTensor = tf.tensor2d(outputVariations, [nbSamples, nbDataOutput], 'float32');
    let inputTensor = tf.tensor2d(inputs, [nbSamples, config.nbPeriods * config.nbDataByPeriod], 'float32');
    let outputTensor = tf.tensor2d(outputs, [nbSamples, nbDataOutput], 'float32');

    inputTensor.print();
    outputTensor.print();

    // train the model for each tensor
    const response = await model.fit(inputTensor, outputTensor, config.trainingOptions);

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